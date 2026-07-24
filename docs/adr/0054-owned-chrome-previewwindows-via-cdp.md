# ADR-0054: Own Chrome PreviewWindows via the DevTools Protocol over HTTP

## Context

Deck gives each Worktree persistent Terminals (owned — a tmux session on the
DeckSocket, ADR-0011/0012) and surfaces Claude ChatSessions (observed — the
Claude extension owns them, ADR-0053). It had no **browser** surface: when you
work in a Worktree you want to look at *that Worktree's* running app, in a real
Chrome window, not VS Code's integrated Simple Browser.

The forces:

- The window must be a real, explicitly-opened Chrome window (the user asked for
  Chrome, not an embedded webview), and Deck must be able to **list, open,
  reveal, and close** it — the "owned" end of the spectrum, like Terminals.
- A Worktree runs one or more dev servers, each on a port. For a browser URL to
  match a running server without a fragile handshake, the port must be
  **deterministic and Deck-controlled**.
- Multiple Worktrees run concurrently, so their browser instances must be
  isolated and able to run in parallel.
- The user needs certain Chrome extensions available in preview windows.

## Decision

**The DeckBrowser is owned like Terminals, but Chrome's own mechanisms replace
most of the durability machinery.**

1. **One isolated Chrome instance per Worktree; one `--app` window per preview.**
   Each Worktree gets a Deck-managed `--user-data-dir` and a
   `--remote-debugging-port`. Each **PreviewDefinition** (a named preview,
   declared in config exactly like a TerminalLauncher: committed
   `<worktree>/.deck/previews.json`, per-Repository `deck.repositoryPreviews`,
   global `deck.previews`) opens as a `--app` window in that instance. A window
   is identified by its **PreviewPort**, so a CDP target is matched by port —
   robust to path redirects.

2. **Deterministic PreviewPort, injected as env.** The port is
   `portBase + slot(worktreePath)`, where the slot is a stable hash of the
   Worktree path (mirroring how a tmux session name is derived from it,
   ADR-0011). Deck injects the port as an env var (e.g. `PORT`) on every Terminal
   it creates for the Worktree (`tmux new-session -e`), so the dev server and the
   PreviewWindow URL agree with no handshake.

3. **CDP over plain HTTP `/json`, not WebSocket.** Deck lists/reveals/closes
   windows through the DevTools Protocol's HTTP endpoints (`/json/version`,
   `/json/list`, `/json/activate`, `/json/close`) — the DeckBrowser's analog of
   `tmux list-sessions`. No WebSocket connection and no new runtime dependency.

4. **Spawn Chrome directly, argv array, no shell.** The instance is spawned
   detached with an argv array (never a shell string) — the security posture of
   ADR-0012 — so Deck captures the pid for teardown; app-raising uses macOS
   `open -b`.

5. **Observation is a focus-gated poll (BrowserPoll), not a CDP event client.**
   A ~2s poll while the window is focused matches PreviewWindows to their targets
   by port and drives the "open" badge — the same latency/complexity trade-off
   ADR-0052 made for ExternalTerminalWatch.

6. **The profile dir is the persistence layer and the cross-window singleton.**
   Unlike tmux, a `--user-data-dir` persists on disk and Chrome enforces one
   instance per profile, so a second VS Code window launching the same Worktree's
   Chrome is routed to the running instance. Deck therefore needs **no
   RecoveryLock, no restoreGate, and no tmux-resurrect analog**. Only a light
   file-backed `BrowserStateStore` under `deckDir` records each Worktree's
   allocated debug port, profile-seeded flag, and instance pid (file-backed for
   the same cross-window reason as the pending-open queue, ADR-0053).

7. **Extensions via profile-template seed.** On a Worktree's first launch Deck
   copies `deck.chromeProfileTemplate` — a profile the user set up once with
   their extensions — into the Worktree's fresh profile dir (guarded so it never
   copies over a live profile). This supports Web-Store extensions with no
   developer-mode nag.

8. **Cleanup rides the existing removal seam.** WorktreeRemoval and
   RepositoryRemoval invoke a best-effort `closeWorktree` beside the
   TerminalCascade — killing the instance, removing the profile, and clearing
   state — so a Chrome failure never blocks git removal.

## Rejected: observing the user's own Chrome (the ChatSession model)

Discovering windows in the user's normal Chrome over a shared
`--remote-debugging-port` was considered (the "observe, don't own" end). Rejected
for the MVP: it requires the user to launch Chrome with a debug flag, gives no
per-Worktree profile isolation, and makes URL→Worktree mapping fuzzier than a
Deck-assigned port. **Revisit trigger:** users who want their logged-in profile
and reject an isolated one, or who won't run Deck-managed Chrome instances.

## Rejected: reboot auto-relaunch (BrowserSnapshot) in the MVP

Persisting the set of open PreviewWindows and reopening them on activation was
deferred. The profile dir plus Chrome's own tab restore already give continuity
on manual reopen, and auto-spawning browser windows on every boot is intrusive.
**Revisit trigger:** users expect PreviewWindows to survive reboot the way
Terminals do (a `deck.reopenPreviews` opt-in).

## Consequences

- Deck now owns a browser process lifecycle, but the surface is small: launch
  (spawn), observe (HTTP poll), reveal/close (HTTP), teardown (kill pid).
- PreviewWindows use an isolated profile, not the user's default Chrome — logins
  come only from the seeded template.
- Deterministic ports can collide across many concurrent Worktrees (same hash
  slot); the second dev server then fails to bind, which the user sees. The slot
  span is a deliberate readability/collision trade-off.
- macOS only for now: launch and app-raising use the Chrome app bundle and
  `open`. Linux/Windows launchers are a later addition.

## Known limitations

- Configuring `deck.chromeProfileTemplate` after a Worktree's first launch does
  not retroactively seed it (the profile already exists).
- HTTP-only CDP has no reload verb, so Reload is close-then-reopen.

## Refines

- Owned-surface durability and process spawning: [ADR-0012](./0012-terminal-transport-tmux-control-mode.md).
- Poll-over-event-client for external discovery: [ADR-0052](./0052-external-terminal-discovery-via-session-set-poll.md).
- Per-Worktree surface that Deck does not fully own: [ADR-0053](./0053-claude-chat-sessions.md).

## Status

Accepted.
