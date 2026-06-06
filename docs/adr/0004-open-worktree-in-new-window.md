# ADR-0004: Window-per-Worktree as an opt-in no-reload escape hatch

> **Note:** The FocusIntent mechanism described below was retired in
> [ADR-0006](./0006-deck-lives-in-secondary-sidebar.md). The DetachedOpen
> behavior otherwise stands.

## Context

ADR-0003 declared `vscode.openFolder` (with its mandatory window reload) the
canonical switch mechanism, accepting the ~1–3s blip plus language-server
re-index because (a) tmux was carrying the in-memory state that mattered, and
(b) VS Code's per-folder `workspaceStorage` restored tabs / dirty buffers /
layout for free per Worktree.

In practice the reload is more disruptive than ADR-0003 weighed: TS server
cold re-index, broken debug sessions, dead webview state, and a respawn of
every other extension's activation events all stack on top of the workbench
reload itself — and the pain crosses Project boundaries, not just intra-Project
Worktree swaps.

Alternatives considered:

- **Restore ADR-0002 multi-root mounting.** Rejected (again) — the explorer /
  search / SCM noise of N mounted Projects is exactly what ADR-0003 walked away
  from. Index-0 Project still reloads anyway.
- **Sentinel folder pinned at index 0 + active Worktree at index 1.** Would
  eliminate reloads entirely. Rejected — forces Deck to re-implement the
  TabSnapshot feature ADR-0003 retired (all Worktrees would share one workspace
  identity, losing VS Code's free per-folder restore). Too much work for the
  payoff.
- **Hybrid intra-Project-free, cross-Project-reload.** Rejected — the user's
  pain is cross-Project too, so this fixes only half the problem while still
  paying the TabSnapshot rebuild cost within a Project.
- **Make `vscode.openFolder` default to a new window.** Rejected — every click
  on the tree would spawn a window, accumulating noise fast. The default click
  should stay destructive-in-place (the user's mental model from ADR-0003).
- **Palliative: persistent terminals + leaner activation events.** Already
  handled out-of-band (tmux). Doesn't fix the LS / debug / webview costs.

## Decision

Add `deck.openWorktreeInNewWindow` as an opt-in right-click action on Worktree
tree nodes. It calls
`vscode.commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true })`
plus `setFocusIntent(true)` so the new window lands on the Deck Activity Bar.

The default click on a Worktree remains today's SwitchOperation (reload
in-place per ADR-0003). The new action is an **escape hatch**: it lets the
user keep the current window's in-memory state alive when they need to peek at
another Worktree, at the cost of accumulating windows.

### Mechanics

- Right-click context menu only on `viewItem == deck.worktree` and `viewItem ==
  deck.worktree.main`. Hidden on `deck.worktree.active` — opening the current
  window's own Worktree in a new window is a no-value gesture, hidden via the
  menu `when` clause rather than a runtime block.
- Hidden from the Command Palette (it needs a Worktree node argument).
- Does **not** update `ActiveWorktree[commonDir]`. The original window's
  Worktree remains the "active" one in the store; the new window simply
  exists alongside. The tree's ✓ marker is computed per-window from
  `workspaceFolders[0]`, so each window correctly marks its own Worktree.
- Sets `FocusIntent` so the new window opens with the Deck Activity Bar
  focused, matching the post-switch UX. Theoretical race (another Deck
  window reactivating concurrently steals the intent) is accepted as
  vanishingly rare.
- No pre-check that the Worktree path still exists on disk. Matches
  SwitchOperation and AddProject — fix all three together if validation
  ever becomes worth the cost.

## Consequences

- The user controls the window/reload tradeoff per invocation: cheap-but-noisy
  (new window) vs in-place-but-destructive (default switch).
- Over a session, users accumulate windows for the Worktrees they keep coming
  back to. Each window's LS, terminals, debug, and webview state survives
  because that window never reloaded.
- `vscode.openFolder` with `forceNewWindow: true` may open a duplicate window
  if the target Worktree is already open in another window — VS Code doesn't
  expose other windows to extensions, so we can't dedupe. Accepted.
- `ActiveWorktree` continues drifting toward vestigial — post-ADR-0003 it
  only serves removal-hygiene, and this ADR explicitly bypasses it. A future
  cleanup could likely delete the store entirely. Not in scope here.

## Refines

- ADR-0003 (single-folder switching via `vscode.openFolder`). The default click
  semantics are unchanged. This ADR adds a sibling action with different
  semantics; it does not supersede ADR-0003.

## Status

Accepted.
