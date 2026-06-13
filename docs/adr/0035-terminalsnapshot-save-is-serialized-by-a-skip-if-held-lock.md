# ADR-0035: TerminalSnapshot save is serialized by a skip-if-held lock

## Context

Each VS Code window runs its own periodic TerminalSnapshot save
(`startPeriodicSave`, every 5 min) and a final save on `deactivate`. The save is
tmux-resurrect's `save.sh`, which writes one timestamped file then re-points the
`last` symlink:

```sh
fetch_and_dump_grouped_sessions > "$resurrect_file_path"   # truncate
dump_panes   >> "$resurrect_file_path"                      # append
dump_windows >> "$resurrect_file_path"                      # append
...
```

The filename is **second-resolution** (`helpers.sh`: `date +"%Y%m%dT%H%M%S"`).
The DeckSocket is shared by every window, but save was never coordinated across
them. Two windows activate at nearly the same instant, so their 5-min timers
fire **in lockstep** — in the *same second* — producing the *same* filename, and
both `>>`-append into it. Every pane and window line is written twice.

Restore then replays a doubled file. `restore.sh`'s `restore_all_pane_processes`
iterates **every** `^pane` line and `send-keys` its command, so a duplicated pane
line sends the agent's resume command **twice**: the first `send-keys` starts the
agent, the second lands in the now-running agent's **input box**.

This surfaced in multi-window cold-open QA *after* ADR-0034 fixed restore
(21/21 agents resumed) — every resumed agent had `claude --resume <id>` typed
into its prompt. Confirmed empirically: the on-disk save file had **66 pane lines
for 33 panes** (every line doubled), window lines doubled too, while live tmux had
no duplicate panes (33/33) and an old single-window save was clean (17/17). The
`deactivate` race is the worst case — on Cmd+Q both windows save in the same
second, and that final save is exactly the file restore reads.

This is the same class as ADR-0034: an **uncoordinated per-window action on the
shared DeckSocket**. ADR-0034 coordinated *restore*; *save* was left
uncoordinated.

## Decision

1. **Serialize save across windows with a skip-if-held file lock**, reusing the
   `RecoveryLock` class (ADR-0030) with a third file, `deck-socket-save.lock`,
   alongside `…-recovery.lock` (ADR-0030) and `…-restore.lock` (ADR-0034).

2. **The losing window skips its save entirely — it does not block.** This is the
   deliberate inverse of the restore lock, and the asymmetry is the crux: the
   TerminalSnapshot is **shared, identical state**, so the winner's save already
   captures everything the loser would have. The loser needs *nothing back*, so
   it skips. (The restore loser, by contrast, must *block*: it needs the restored
   sessions to exist before its terminal tabs reattach.) **The loser's behavior is
   dictated by what it needs from the coordinated action** — restore returns a
   result the loser depends on; save returns nothing the loser depends on.

   So the save lock uses the **non-blocking `acquire()`**, never `acquireBlocking`:

   ```
   save():
     if not saveLock.acquire(): return     # another window is saving the same state
     try: runShell(save.sh)
     finally: saveLock.release()
   ```

3. **The guard lives inside `save()`**, the single chokepoint, so both the
   periodic timer and `deactivate` are covered by one lock. `save()`'s contract
   becomes "save *unless* another window is mid-save" — a silent skip, correct for
   both callers because the state is shared.

4. **TTL is the default 60s.** Save is a `capture-pane` of the live panes —
   seconds, well under 60s, so a peer's tick never steals the lock mid-save
   (which would re-introduce doubling). 60s ≤ the 5-min interval, so a holder that
   died mid-save has its lock steal-able by the next tick; saves resume after at
   most one skipped interval.

5. **Fix the cause only; do not dedupe at restore.** Once save writes clean
   files there is no doubling to defend against, and restore-side dedupe is extra
   surface for a case that can no longer occur. (Residual: snapshots already on
   disk are doubled, so the *next* restore can still double-send until the first
   post-fix save overwrites `last` — self-healing.)

## Considered Options

- **Unique filename + atomic symlink swap in `save.sh`** (make
  `resurrect_file_path` unique per invocation; two concurrent saves write two
  complete files, `last` swaps to the later). Structurally collision-proof with no
  lock — rejected as primary: it modifies the vendored resurrect script and leaves
  both windows doing redundant capture-pane work every tick. The skip-if-held lock
  also *eliminates the redundancy*.
- **Lifetime election (one window owns saving, failover on close).** Rejected:
  most lifecycle complexity (ownership renewal, handoff when the owner window
  closes) for no benefit over per-tick skip.
- **Loser blocks then re-saves (mirror the restore lock).** Rejected: pointless
  work — the winner already captured the same shared state; blocking would only
  delay `deactivate` and re-save identical bytes.
- **Restore-side dedupe of duplicate pane lines.** Rejected as primary (see
  Decision 5); viable belt-and-suspenders but unnecessary once the cause is fixed.

## Consequences

- **Three lock files** now live in `deckDir`: recovery (wedged-socket reset),
  restore (cross-window restore), save (cross-window save). Each guards a distinct
  action on the shared DeckSocket.
- **Redundant double-capture is gone** as a bonus — only one window captures the
  snapshot per tick.
- **`save()` can silently no-op.** Acceptable and intended; the only observable
  effect is that the skipping window relies on the other's save of the same state.
- **Clean-shutdown edge:** if the winner is killed mid-save on Cmd+Q before the
  symlink swap, `last` stays at the previous periodic save (save.sh re-points
  `last` only after a complete write), so we lose ≤5 min of scrollback — strictly
  better than today's doubled/corrupt deactivate file.
- **Verification** is layered: a unit test (`save()` runs+releases when the lock
  is free; skips+does-not-release when held; two runtimes sharing one fake lock →
  exactly one `runShell`), then a cheap live check (save file pane-lines ==
  unique), then the full multi-window reboot (agents resume with empty input
  boxes).

## Refines

- **ADR-0034.** Same cross-window-coordination theme and same `RecoveryLock`
  primitive, applied to save. Names the **skip-vs-block asymmetry**: the loser's
  behavior follows from whether it needs a result from the coordinated action
  (restore: yes → block; save: no → skip).
- **ADR-0030.** Reuses the `RecoveryLock` primitive for a third lock.

## Status

Accepted.
