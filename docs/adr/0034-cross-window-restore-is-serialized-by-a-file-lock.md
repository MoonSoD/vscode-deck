# ADR-0034: Cross-window restore is serialized by a file lock

## Context

The restore gate (ADR-0032) makes restore single-flight **within one VS Code
process**: `createRestoreCoordinator` holds an in-memory `inFlight` promise, so
concurrent callers in the same window (every terminal reattach, `+`, reconnect)
run `restoreOnActivation` once and the rest await it.

That dedup is **process-local**. The DeckSocket is shared by every VS Code
window (`tmux -L deck`), but each window has its own extension host, its own
coordinator, and its own `inFlight`. So with two or more windows open, nothing
serializes restore *across* them.

On a real reboot — Cmd+Q, the socket dies, reopen with two windows — both
windows activate against the dead socket and both enter the `down` branch of
`ensureRestored` concurrently. `restoreOnActivation` is not idempotent under
concurrency:

```
Window A                          Window B
─────────────────────────────────────────────────────────
classify → down                   classify → down
inFlight = restoreOnActivation()  inFlight = restoreOnActivation()
killAnchor (noop)
startServer → __deck_anchor up
beforeRestore (rewrite, SLOW…)    killAnchor → kills A's anchor
                                  → zero sessions → exit-empty exits the server
restore.sh → races a dead /
  half-recreated server → panes
  land as bare shells
```

The exact destructive interleaving varies (anchor-kill vs duplicate-session vs
two `restore.sh` runs), but they all stem from one gap: **two windows run the
mechanical restore at the same time.** Live multi-window QA confirmed it — after
a two-window `kill-server` + reopen, 19 of 20 agents came back as bare shells
(only one survived, manually resumed).

It is **non-destructive** — sidecars survived 20/20 (no prune to race, sweep is
lifetime-gated per ADR-0033), so it self-heals on the next *single-window*
server-death. But a multi-window user effectively never gets a clean
single-window restart, so they never auto-resume. Multi-window reboot is common
enough to fix.

`RecoveryLock` (ADR-0030) already provides a TTL'd file mutex — `acquire` /
`release` / `waitForHealthy`, owner-token, steal-after-TTL — but it is wired only
to guard the **wedged-socket reset**, nested *inside* `restoreOnActivation`. It
does not guard the restore itself.

## Decision

1. **Serialize restore across windows with a second file lock**, reusing the
   `RecoveryLock` class with a **separate file**, `deck-socket-restore.lock`
   (alongside the existing `deck-socket-recovery.lock`). Two distinct concerns:
   `…-recovery.lock` guards the rare wedged-socket *reset* (inner);
   `…-restore.lock` guards the *whole restore* across windows (outer). A single
   shared lock would couple the two and force reentrancy reasoning whenever
   either path changes, because the recovery lock is acquired *nested* within the
   restore.

2. **The lock lives in the coordinator (`restoreGate.ts`), wrapping `restore()`.**
   The coordinator already owns the should-I-restore / am-I-restoring / is-it-done
   logic; `restoreOnActivation` stays the mechanical *how* and learns nothing
   about windows. The `down`/`bare` branch becomes:

   ```
   inFlight = guardedRestore()          // process-local fast path stays
     guardedRestore:
       await restoreLock.acquireBlocking()        // poll until held, or steal after TTL
       try:
         if (await classify()).kind === 'restored' return   // winner already did it
         await deps.restore()                                // else we restore
       finally:
         await restoreLock.release()
   ```

3. **The losing window blocks on acquiring the lock, then becomes a fallback
   restorer.** It does not bail — its own tabs reattach through the same gate, and
   reattaching before sessions exist would resurrect blank sessions ahead of
   restore (the bug ADR-0032's gate prevents). When it finally acquires the lock
   (winner released after finishing, or TTL stole a dead holder's lock) it
   re-`classify`s: `restored` → release and return (no re-run); `down`/`bare` →
   restore itself (the winner died or the snapshot was empty). Every window is a
   serialized potential restorer.

4. **`RecoveryLock` grows a blocking `acquireBlocking()`** — `acquire()` returns
   `false` immediately if the lock is held-and-fresh; the blocking variant polls
   (reusing the existing `pollIntervalMs` / `clock.sleep` knobs) until acquired or
   timeout. The **timeout must exceed the TTL** so a dead holder's lock becomes
   steal-able before the waiter gives up.

5. **Fixed 60s TTL, no heartbeat.** Restore is normally a few seconds; 60s is
   comfortable headroom. If a restore somehow exceeds it, the blast radius is
   bounded — the stealer re-`classify`s before acting, so a winner that already
   created the sessions is seen as `restored` and skipped.

6. **Fail-open on the (near-impossible) blocking-acquire timeout.** Because
   timeout > TTL, a timeout should never fire. If it does, the coordinator
   proceeds with the restore anyway rather than aborting activation — consistent
   with ADR-0019 ("a failed sub-step must never abort restore").

## Considered Options

- **Leave it (accept the race).** It's non-destructive and self-heals on a
  single-window restart — rejected: multi-window users never get that restart, so
  they never auto-resume, and multi-window reboot is common.
- **Leader election / a designated restorer window.** There is no cross-window
  coordinator process to elect one; a file lock *is* the lightweight election,
  with steal-after-TTL handling the leader dying.
- **One shared lock for recovery + restore.** Rejected: couples two concerns and,
  because recovery acquires nested inside restore, invites reentrancy bugs.
- **Wait for `classify === restored` instead of acquiring the lock.** Rejected:
  hangs forever on an empty snapshot (never `restored`) or a dead winner — no
  fallback, no TTL escape.
- **Heartbeat the lock with a short TTL.** Rejected: a refresh timer + `touch`
  method is machinery for a rare slow path; fixed 60s is simpler and the
  re-`classify` guard bounds the downside.
- **Make `restoreOnActivation` idempotent under concurrency.** Two concurrent
  `restore.sh` runs recreating the same sessions fundamentally conflict;
  serializing is cleaner than making the resurrect flow re-entrant.

## Consequences

- **A window's activation can now block** (up to the lock timeout) while another
  window restores. This is correct — it has nothing to do until sessions exist —
  but it is the surprising part: activation gating on a file lock.
- **Two lock files** now live in `deckDir`. They have a strict order — restore
  (outer) is only ever held *around* `restoreOnActivation`; recovery (inner) is
  only ever acquired *inside* it — never reversed, different files, so no
  deadlock.
- **Winner death self-heals**: a holder that dies mid-restore has its lock stolen
  after the TTL, and the next waiter falls back to restoring. Worst case, a
  blocked window waits up to ~TTL.
- **The lock file persists across reboot** (it's in `deckDir`). A stale lock from
  before a reboot has an mtime far older than the TTL, so it's immediately
  steal-able — no manual cleanup.
- **Verification is layered**: a two-coordinator unit test (one shared fake lock →
  exactly one `restore()`, loser short-circuits, winner-failure → loser falls
  back) and an `acquireBlocking` unit test (block-while-held, wake-on-release,
  steal-when-stale, timeout > TTL). Integration confidence comes only from the
  live multi-window cold-open — the level that has actually caught every prior
  regression — which gates "done".

## Refines

- **ADR-0032.** The classified-union restore gate is now single-flight *across
  windows*, not just within one process. `ensureRestored`'s `down`/`bare` branch
  acquires the restore lock before calling `restore()`; the in-memory `inFlight`
  stays as the in-window fast path beneath it.
- **ADR-0030.** Reuses the `RecoveryLock` primitive for a second, outer lock. The
  recovery lock's role (wedged-socket reset) is unchanged.
- **ADR-0033.** Closes the multi-window gap that ADR-0033 left explicitly deferred
  and noted as non-destructive: the sweep + sidecar-removal changes made the race
  harmless, this makes it *resume correctly*.

## Status

Accepted.
