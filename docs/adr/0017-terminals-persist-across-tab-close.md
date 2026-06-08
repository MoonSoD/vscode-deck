# ADR-0017: Terminals persist across tab-close; foreign Terminals open in place

## Context

ADR-0011 §6 made closing a terminal tab kill its tmux session — *"The choice
of kill over detach is deliberate — closing a terminal tab terminates its
work."* `extension.ts` implements it: the `onPanelDispose` handler runs
`tmux.killSession(...)`.

That model treats the tab as the Terminal. The product model has shifted: a
**Terminal is like a file** — the durable thing — and its editor tab is just a
**view** onto it. Closing a view must not destroy the file. ADR-0015 already
moved the surface most of the way there (the tab URI is a file-path carrying
the full worktree, and the session reattaches by name regardless of what is
mounted), so the persistence the file-model implies is already mechanically
within reach.

Two current behaviours contradict the file-model:

1. **Kill-on-tab-close** (ADR-0011 §6) — closing the tab ends the work.
2. **Switch-on-foreign** — clicking (or adding) a Terminal whose Worktree is
   not mounted triggers a **Switch** to that Worktree
   (`openTerminalCommand.switchForForeignWorktree`,
   `addTerminalCommand.switchForForeignWorktree`), rather than opening the tab
   where you are. A file opens from anywhere; a Terminal should too.

## Decision

1. **Tab-close is non-destructive.** The panel-dispose handler no longer kills
   the session — it only refreshes the tree. Closing a tab disposes the
   transport, which kills the `tmux -C` control client (a detach, not a
   `kill-session`); with `destroy-unattached off` (already set in `deck.conf`)
   the session survives. The single `killSession` call in the dispose handler
   was the only thing destroying a Terminal on tab-close. Reopening the sidebar
   row reattaches.

2. **`TerminalRemoval` is the explicit destroy**, surfaced as **"Delete
   Terminal"** — a **trash** icon (replacing the `$(close)` X and the "Close
   Terminal" title), plus right-click and a `cmd+backspace` keybinding scoped
   to a focused terminal row in the tree. Mirrors "Delete Worktree…". The
   sidebar affordance no longer reads as "close".

3. **Shell `exit` still destroys.** When the shell exits, the pane's process
   dies, its window closes, and the single-window session ends *in tmux*
   (no `remain-on-exit`) — so the row drops on the next refresh. tmux itself
   draws the line: shell-exit ends the session, control-client detach does
   not. The dispose handler needs no logic to tell the two apart; it stops
   killing and lets tmux decide.

4. **Foreign Terminals open in place.** Clicking or adding a Terminal opens
   its tab in the current window via `vscode.openWith` on the encoded URI —
   no Switch — for any Worktree. `switchForForeignWorktree` is removed from
   both `openTerminalCommand` and `addTerminalCommand`. `pendingTerminalOpens`
   and `switcher` survive only on the "Open Terminal in New Window" path.

5. **The worktree-on-tab label is descoped.** `WebviewPanel` exposes only
   `title` and `iconPath` — no `description`, and tab tooltips are not
   settable — so the native integrated-terminal look (dimmed folder suffix)
   is unreachable for a custom-editor webview tab. The Terminal's Worktree is
   already visible on tab **hover** for free, derived from the ADR-0015 URI
   path (`deck-terminal:/<worktree>/term-N`). A visible in-title suffix is
   deferred, not adopted.

## Considered Options

- **`remain-on-exit` zombie Terminals** — keep the row after the shell exits,
  reopen showing "[process exited]" until Deleted. Rejected: fully file-like
  but litters the tree with dead rows and needs a tmux config change; `exit`
  is a clear "I'm done" signal.
- **Bake `name — worktree` into `panel.title`** — convey the Worktree without
  the native dimming. Deferred under decision 5: same-colour, not the
  screenshot look, and hover already carries the fact.

## Consequences

- **Supersedes ADR-0011 §6.** "kill over detach" is reversed to
  "detach/persist; destroy only on explicit `TerminalRemoval` or `exit`."
- Persistence rides on tmux's `destroy-unattached off` (already configured for
  switch-survival) plus the transport's detach-not-kill teardown; the dispose
  handler simply drops its `killSession` call. No dispose-cause detection, no
  new transport plumbing.
- ADR-0013's per-folder native tab restore is unchanged: a foreign Terminal
  tab opened while Worktree A is mounted is part of A's window's tab set —
  torn down on Switch away, restored on return; the session persists either
  way.
- ADR-0014 (rows from live tmux) means a shell-`exit` row drops on the next
  refresh without bespoke pruning.
- **cwd correctness becomes load-bearing, and already holds.** With no Switch,
  a foreign Terminal is created/opened while a *different* Worktree is mounted.
  Its cwd is still its own Worktree because every path derives the cwd from the
  URI's dirname (ADR-0015) — passed as tmux's explicit `-c <worktree>` flag and
  the spawn cwd — never from `workspace.workspaceFolders`. (`new-session -A`
  ignores `-c` for an existing session, so a Terminal keeps its creation-time
  cwd, which was always the worktree.)

## Refines

- **ADR-0011.** §6 superseded (tab-close no longer kills). The
  custom-editor surface, URI identity (ADR-0015), and cascade carry forward.
- **ADR-0008.** The §10 Terminal lifecycle is updated: tab-close removed as a
  death trigger; the survivors are `TerminalRemoval` ("Delete"), shell `exit`,
  and Worktree/Repository removal.

## Status

Proposed.
