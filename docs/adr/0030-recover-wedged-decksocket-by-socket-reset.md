# ADR-0030: Recover a wedged DeckSocket by socket-reset, not server-kill

## Context

The DeckSocket can wedge: the tmux server is alive but stuck in an "exiting" /
unresponsive state, still holding its socket. Every `tmux -L deck …` then
connects and is dropped — `server exited unexpectedly`. In that state Deck is
unusable: the tree can't list sessions, terminals can't attach, and recovery
can't even start a replacement, because `new-session` hits the held socket and
fails the same way. We hit this in practice: a QA `kill-server` left the server
stuck, pinned by orphaned control clients (the leak fixed separately in
`767da0c`), and a Jun-11 session under load average ~16 (thermal throttling) is a
plausible second trigger — CPU starvation is a natural analog of a frozen server.

`isMissingSession()` already routes the *clean* states (`no server running`,
`error connecting`) into the normal restore path; the wedge is the one state
with no in-product recovery. The only escape was killing processes by hand.

Empirically verified primitive: deleting the socket file and running
`new-session` starts a **fresh** server; the old one keeps running as an
unreachable zombie (reaped at reboot). No PID-hunting or `kill` required.

## Decision

Recover automatically, inside the existing restore path, by resetting the socket.

1. **Detect** narrowly: the wedge is `server exited unexpectedly` **and** the
   socket file present — only that signature. (Silent recovery depends on this
   staying narrow; do not widen it without revisiting decision 4.)

2. **Recover inside `restoreOnActivation`**, not a new supervisor. The restore
   gate already runs whenever `isServerRunning()` is false — which a wedge
   produces — so it already fires on every reload. The new branch: when
   `newAnchorSession()` fails with the wedge signature, **`rm` the socket and
   retry**, then restore the TerminalSnapshot as usual (ADR-0019).
   - Socket path is computed as tmux resolves `-L deck`:
     `${TMUX_TMPDIR:-/tmp}/tmux-<uid>/deck` (literal `/tmp`, not `os.tmpdir()`).

3. **Confirm before the destructive step**: a 3× read-only `has-session`
   re-probe; act only on **unanimous** failure (a merely slow/starved server
   succeeds on one and aborts recovery). Re-run under the lock, immediately
   before `rm` — this doubles as the cross-window race guard.

4. **Silent-auto, with progress**: a confirmed wedge is permanent, so there is
   nothing to preserve and a consent prompt is empty friction. Surface a
   progress notification whenever the server is (re)started and the snapshot
   restored (cold boot, reboot, *and* wedge), and a `Restoring terminals…`
   `treeView.message` banner meanwhile. The notification states the actual last
   save time from `stat(<deckDir>/resurrect/last).mtime`.

5. **Coordinate across windows** with an atomic lockfile
   (`<deckDir>/recovery.lock`, `O_EXCL`, ~60s TTL stale-takeover). The DeckSocket
   is machine-global; on wake/reboot every window reactivates at once, and an
   uncoordinated `rm`-and-restart would run the resurrect restore twice. The
   loser waits for `isServerRunning()` to go true, then reattaches.

6. **Reattach on reload only.** `listSessions` treats the wedge as empty (no
   throw); the tree repopulates via `refreshTree` once recovery completes. Open
   tabs reattach through VS Code's custom-editor restore on the next reload —
   no auto-restart of stale transports.

## Considered Options

- **Kill the wedged server by PID** (what manual recovery did). Rejected:
  identifying it means pattern-matching `tmux … -L deck` processes (fragile, and
  would also catch other windows' clients), and `lsof` on the unix socket is
  unreliable on macOS. Socket-reset sidesteps identification entirely.
- **Reap the old zombie server after reset.** Rejected for v1: re-introduces the
  fragile PID-hunt for a benign, rare leak that a reboot clears.
- **Prompt / one-click recovery.** Rejected: a confirmed wedge leaves nothing to
  save, so consent is friction; the progress notification keeps the user informed.
- **A `DeckServerSupervisor` wrapping every command.** Rejected: the restore path
  already fires on the wedge; an extra abstraction buys little.
- **Auto-reattach open tabs** via a new `transport.restart()`. Deferred: reload
  already reattaches, and a wedge-without-reload is the rarer path.

## Consequences

- Recovery is destructive in the same way the wedge already is: live sessions are
  gone, restored to the last TerminalSnapshot (~5-min periodic save). No data is
  lost that the wedge had not already stranded.
- A leaked zombie server (and its orphaned control clients) survives until reboot.
- Safety rests on the narrow detector (decision 1) + unanimous re-probe (3); a
  loose detector plus silent-auto would be the dangerous combination.
- A **hard-killed** host (OOM / thermal / `kill -9`) bypasses this — it runs at
  activation, not on crash — consistent with the limitation in ADR-0012 (no PTY).

## Status

Accepted (design). Implementation to follow.
