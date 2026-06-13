# ADR-0036: Save and restore share one snapshot lock, with PID-liveness steal

## Context

ADR-0034 serialized cross-window **restore** with a blocking file lock
(`deck-socket-restore.lock`); ADR-0035 serialized cross-window **save** with a
skip-if-held file lock (`deck-socket-save.lock`). They were separate locks. But
save and restore are **inverse operations on the same shared state**: save reads
the live DeckSocket sessions and writes the TerminalSnapshot; restore reads the
TerminalSnapshot and writes the live sessions. Nothing coordinated them with each
other.

The kill-while-VS-Code-open + reload QA exposed the gap. On reload VS Code kills
and restarts the extension host; the reactivation runs restore, while the *other*
window's `deactivate` save fires concurrently. Observed:

- **Partial save clobbered `last`.** A window's save ran while another window was
  mid-restore (≈19 of 33 sessions recreated), captured the partial set, and — via
  resurrect's atomic symlink swap — that 19-pane file became `last`. A reboot
  before the next full save would have restored only 19 sessions, silently
  dropping 14 terminals. (Confirmed: on-disk `last` had 19 pane lines while live
  tmux had 33.)
- **Stale lock files.** Reload kills the ext host mid-operation, so the `finally`
  that releases the lock never runs. Both lock files were left held.

The stale-lock residual was previously deemed benign (ADR-0030's TTL self-heals
it). It is **not** benign once save and restore share a lock: a stale lock from
an interrupted save would block the next restore until it could *steal* — up to
the full TTL (~60s) — turning reload into a multi-second hang before sessions
return. So unifying the locks (the right model) forced fixing the stale-lock
recovery (which the test proved reload triggers).

A leaked `__deck_anchor` was also observed, but it is genuinely benign:
`classify()` filters the anchor from `realSessions` (ADR-0032), and every other
`listSessions` consumer filters by the `wt-` prefix the anchor doesn't match, so
it can never produce a wrong DeckSocket state or a phantom sidebar row. The next
restore's initial `killAnchor` removes it. Left as an accepted residual.

## Decision

1. **Save and restore share one lock: `deck-socket-snapshot.lock`**, replacing
   the separate `…-restore.lock` and `…-save.lock`. Two `RecoveryLock` instances
   point at the one file (the coordinator's restore handle, the runtime's save
   handle) — the same way two windows already share a lock file.

   - **Restore** acquires it **blocking** (`acquireBlocking`) — the loser blocks,
     because it needs the restored sessions before its tabs reattach (ADR-0034).
   - **Save** acquires it **non-blocking → skips** if held (ADR-0035) — the loser
     skips, because the snapshot is shared state the holder is already capturing.

   Because they share the file, **a save skips while a restore holds the lock**
   (the partial-save race, #1, is prevented at the root) and a restore waits out a
   quick in-flight save. Save and restore are now mutually exclusive in both
   directions — correct, because they are inverse mutations of the same snapshot.

2. **The lock steals a dead holder's lock immediately, via PID-liveness.** The
   lock file stores `{ownerToken, pid, startTime}` (was: `ownerToken` only). On a
   contended acquire the steal condition becomes:

   ```
   steal if  !holderAlive  OR  (now − mtime > TTL)
   where holderAlive = isAlive(pid) && startTime(pid) === stored.startTime
   ```

   A **dead** holder (process gone, or its PID reused → startTime mismatch) is
   stolen in milliseconds; the **TTL stays as a backstop** for a holder that is
   alive but *hung* (a stuck save/restore that never releases). This reuses the
   `ProcessProbe` primitive (`kill(pid,0)` treating `EPERM` as alive; `ps lstart`)
   that `AgentExitSweep` already uses (ADR-0031), injected into `RecoveryLock`
   (default `PsProcessProbe`) for testability.

   The deeper point: **a fixed TTL conflates "the holder is dead" (steal now) with
   "the holder is slow" (wait) — liveness distinguishes them.** This removes the
   reload hang and applies to every lock (recovery + snapshot).

3. **A malformed / old-format lock file** (a bare UUID with no liveness fields)
   falls back to **TTL-only** stealing — we can't probe a holder we can't parse,
   so we don't steal a possibly-live one early.

## Considered Options

- **Keep two locks; restore re-saves at the end (corrective).** Leave save/restore
  uncoordinated, but after `restore.sh` write a fresh full save to fix `last`.
  Rejected: corrective not preventive — a partial `last` exists transiently, and
  the re-save goes through the skip-if-held save path, so a peer's save can make
  it skip and leave `last` partial. Unreliable.
- **Keep two locks; save peeks the restore lock (`isHeld`).** Rejected: a
  read-only peek is a TOCTOU race (restore can acquire right after the peek),
  unlike the unified lock's atomic `O_EXCL` acquire.
- **Accept the stale-lock reload hang (TTL self-heal).** Rejected (Q3): the test
  proved reload reliably leaves stale locks, so post-unify this is a routine
  ~60s reload hang, not a rare edge.
- **Lower the TTL to shorten the hang.** Rejected: TTL must exceed a live restore
  (~13s) or it would steal a real in-flight restore; a ~20-30s floor is still a
  bad hang. PID-liveness removes the hang without weakening the backstop.
- **PID-only liveness (skip the `ps startTime`).** Rejected: a recycled PID would
  read as alive (false negative → unnecessary TTL wait). The startTime match is
  the same PID-reuse guard the sweep uses; the `ps` cost is negligible off the hot
  path.
- **`flock(2)` (kernel auto-release on death).** Rejected: needs a native binding
  the repo deliberately avoids (ADR-0030's hand-rolled `O_EXCL`+TTL lock exists
  for this reason); PID-liveness gets the same dead-holder recovery without a dep.

## Consequences

- **Two lock files, not three:** `deck-socket-snapshot.lock` (save XOR restore)
  and `deck-socket-recovery.lock` (wedged-socket reset, unchanged). Simpler model.
- **The partial-`last` data-loss window is closed** — a save cannot run during a
  restore, so it can never capture a half-rebuilt session set.
- **Reload restores promptly** even when it left a stale lock: the next acquirer
  sees the dead ext host and steals in milliseconds instead of waiting ~TTL.
- **Stale-lock recovery improves for all locks**, including the recovery lock and
  the restore path that ADR-0030/0034 left to TTL-only.
- **Lock file format changed** to JSON; `release` parses it and matches
  `ownerToken`. Old-format files are handled (TTL-only fallback), so a lock left
  by a prior version is still recoverable.
- **Accepted residual:** a leaked `__deck_anchor` (reload kills the ext host
  before restore's `finally killAnchor`). Benign — filtered by `classify` and all
  prefix-scoped consumers; cleaned by the next restore's initial `killAnchor`.
- **Verification:** unit tests for liveness steal (dead ⇒ immediate; alive+fresh ⇒
  no steal; PID-reuse ⇒ steal; alive+hung ⇒ TTL backstop; old-format ⇒ TTL) and
  unified mutual exclusion (save skips under a held restore; restore waits under a
  held save), then the kill-while-open + reload live gate (full `last`, prompt
  restore, 21/21 clean).

## Refines

- **ADR-0034 / ADR-0035.** Supersedes their *separate-lock-files* decision by
  merging `…-restore.lock` and `…-save.lock` into one `…-snapshot.lock`. The
  block-vs-skip loser asymmetry (ADR-0035) is preserved; it now also mediates
  save-vs-restore.
- **ADR-0030.** `RecoveryLock` gains PID-liveness stealing; TTL is demoted from
  the primary recovery mechanism to a backstop for live-but-hung holders.
- **ADR-0031.** Reuses the sweep's `ProcessProbe` liveness pattern (`kill(pid,0)` +
  `startTime`) for lock-holder liveness.

## Status

Accepted.
