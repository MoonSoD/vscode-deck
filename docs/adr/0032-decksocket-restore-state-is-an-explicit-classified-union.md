# ADR-0032: DeckSocket restore state is an explicit, classified union — not `isServerRunning`

## Context

Restore-on-activation (ADR-0019) and wedge recovery (ADR-0030) both decide
"should we restore?" from a single boolean, `isServerRunning()` (`tmux
has-session`). The same boolean gates the **restore gate** (`restoreGate.ts`,
which every terminal reattach / `+` / reconnect awaits before issuing
`new-session`), `restoreOnActivation` itself, and — transitively — the sidecar
**prune** that runs after restore.

That boolean cannot distinguish a server that has *real, restored sessions* from
a server that is merely *up but empty*. Restore brings the server up **itself**,
early, via a placeholder **anchor** session (`__deck_anchor`) so `restore.sh` has
a server to restore into; the anchor is killed when restore finishes. So between
"anchor created" and "restore complete" — or after an **interrupted** restore
(e.g. a window reload mid-restore) — the server is up with only the anchor and
**no real sessions**, yet `isServerRunning()` reports `true`.

This produced a live-QA failure (issue #121 follow-up). On `kill-server` + reload,
a control client (or an interrupted prior-activation restore) brought the server
up ~before the new activation's restore checked `isServerRunning()`. The check
saw `true` → **restore was skipped** → no snapshot rewrite, no `--resume`. Then
`prune` ran against a `listSessions()` that contained only the few sessions that
happened to exist (open tabs), and **deleted the sidecars of every other
terminal**. 19 of 21 agents came back as bare shells; only the two open-tab
sessions survived. The exthost log confirmed the ordering: server started
`16:17:23`, extension activated `16:17:27`.

The root cause is an **implicit state**: each site re-derived "are we restored?"
from a boolean that conflates `bare` with `restored`, and nothing forced anyone
to handle the `bare` case. (Researched the established remedy: "make illegal
states unrepresentable" — Minsky — realized in TypeScript as a discriminated
union with exhaustive `never` checking.)

## Decision

1. **Model the DeckSocket restore lifecycle as an explicit discriminated union**,
   replacing scattered `isServerRunning()` reads:

   ```ts
   type DeckSocketState =
     | { kind: "down" }                                    // no server (incl. empty workspace)
     | { kind: "bare" }                                    // server up, only __deck_anchor
     | { kind: "restoring"; done: Promise<void> }          // restore in flight (in-memory)
     | { kind: "restored"; sessions: ReadonlySet<string> } // ≥1 real (non-anchor) session
   ```

   Consumers `switch` on `kind` with an `assertNever` default, so `bare` must be
   handled everywhere and a future state is a compile error until handled.

2. **The discriminant is "are there real (non-anchor) sessions?", not "is the
   server running".** `__deck_anchor` is explicitly excluded. This is what
   distinguishes `bare` (anchor-only / interrupted restore) from `restored`, and
   it is the single fact the old boolean could not express.

3. **`classify()` is a live, on-demand query — nothing is cached** (honoring
   ADR-0014's "live tmux, not a persisted cache"). It runs `tmux list-sessions`
   each call and returns a *transient* variant consumed immediately. The only
   retained in-memory state is the in-flight `restoring.done` promise (control
   state for dedup, not a mirror of tmux). `restored.sessions` is the set from
   *that* query, handed to `prune` for immediate use, never stored.

4. **One narrow gate, `ensureRestored()`, is the sole server-starter.** Every
   terminal reattach, `+`, and reconnect awaits it before any `new-session`.
   It runs restore **once** when the state is `down`/`bare` (deduped via the
   in-flight promise), awaits an in-flight `restoring`, and returns immediately
   on `restored`. It does **not** loop waiting for `restored`: an empty snapshot
   legitimately yields `down`, and the caller then creates its own session.
   Because restore is the only thing that creates real sessions, "has real
   sessions" reliably means "restore ran" — the invariant the boolean faked.

5. **`prune` is gated by the type on `restored`.** Its signature takes a
   `RestoredState` and uses that variant's live `sessions`. In `down`/`bare`/
   `restoring` there is no `sessions` field, so "prune against an incomplete
   session list" — the bug that deleted 19 sidecars — is **unrepresentable**,
   not merely guarded.

## Considered Options

- **Keep `isServerRunning`, fix sites individually** — rejected: it's the wrong
  predicate; every site would re-derive state from a boolean that can't express
  `bare`, and the next site to forget `bare` reintroduces the bug.
- **Make restore atomic so the server is never observably "up but unrestored"**
  (don't expose the anchor) — a bigger change to the resurrect flow; the
  classified-union approach is smaller and also covers interrupted restore.
- **XState / a statechart library** — rejected: a runtime dependency heavier than
  this single-extension repo warrants; a hand-rolled union + `assertNever` gives
  the compile-time guarantee at the right cost.
- **Full typestate (encode state in phantom types)** — rejected: the server state
  is externally observed and async; encoding it in the type fights the grain.
- **Cache the session list in the state** — rejected: violates ADR-0014 and
  reintroduces a sync-with-tmux problem; `classify()` queries live instead.

## Consequences

- **`restoreGate` and the `isServerRunning` reads in `restoreOnActivation` /
  the prune block are replaced** by `classify()` + `ensureRestored()`. The anchor
  is now a recognized `bare` marker rather than something that masquerades as a
  live, restored server.
- **Interrupted restore self-heals**: `bare` routes back to restore on the next
  gate call instead of being read as `restored` forever.
- **Tabs can no longer start a blank server ahead of restore** — they reach
  `new-session` only after `ensureRestored()`, by which point real sessions exist
  (or the workspace is legitimately empty and they create their own).
- **Residual:** in an empty workspace (`down`), `prune` never runs, so a sidecar
  for a truly-gone session can linger until the next `restored` tick. Non-
  destructive (a stale resume flashes "session not found" → shell); same class as
  the ADR-0031 sweep residual.
- **Couples to one more tmux fact**: `exit-empty` is left at its default `on`, so
  a zero-session server exits — which is *why* there is no stable "restored-but-
  empty" state to misclassify. If `exit-empty` were ever set `off`, `classify()`
  would need to treat a real-session-less server as `down`/`bare` explicitly.

## Refines

- **ADR-0019 / ADR-0030.** Restore and wedge recovery no longer gate on
  `isServerRunning()`; they gate on the classified state (`down`/`bare` → restore,
  `restored` → proceed). The anchor's role is unchanged but now named in the model.
- **ADR-0014.** Reinforced: `classify()` reads live tmux every call; no session
  list is cached.
- **ADR-0031.** Independent of the sweep's server-lifetime gate, but shares the
  theme: liveness/restore decisions must be keyed on the right, lifetime-correct
  fact — not a process-exists boolean.

## Status

Accepted.
