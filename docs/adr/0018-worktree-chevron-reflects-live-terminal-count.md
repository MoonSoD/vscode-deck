# ADR-0018: Worktree chevron reflects live terminal count; worktrees expand by default

## Context

A Worktree row should expand by default so newly added Terminals are visible
immediately, and it should show an expand chevron **only when it hosts at least
one Terminal** — an empty Worktree is a leaf. The "Add Terminal" empty-state
hint row is removed; the always-visible inline `+` on the Worktree row
(`package.json` `view/item/context`, `group: inline`) is the sole add
affordance.

VS Code's `TreeItemCollapsibleState` only seeds the *initial* state; a manual
toggle wins, with one documented asymmetry ([vscode#127711]): a node that starts
`Expanded` and is then collapsed **re-expands** on the next
`onDidChangeTreeData`. `addTerminalCommand`, `killTerminalCommand`, switch, and
worktree-list changes all fire `tree.refresh()`. We accept this: Worktrees that
host Terminals are effectively always-expanded, and a collapse is transient
(undone by the next terminal action). We do **not** own an expansion store.

Making the chevron conditional means a `WorktreeNode` must know its Terminal
count **at build time**. That collides with two accepted decisions, forming a
trilemma — *conditional chevron* + *synchronous worktree render* + *no persisted
terminal cache* cannot all hold:

- **ADR-0007 §3** renders Worktree rows synchronously from `WorktreeListCache`,
  avoiding a blocking subprocess on paint.
- **ADR-0014** resolves Terminal rows live from `tmux list-sessions`, lazily on
  expand, and forbids a persisted mirror (tmux is the single source of truth).

Counts are only knowable from tmux. Caching them would reverse ADR-0014; reading
them at build time blocks the worktree paint, reversing ADR-0007 §3.

## Decision

1. **`WorktreeNode.collapsibleState = hasTerminals ? Expanded : None`.** No
   `Collapsed` default; no "Add Terminal" hint row (`getTerminalChildren`
   returns `[]` when empty instead of a `TerminalAddNode`).

2. **One grouped live `list-sessions` per repo render.** `getWorktreeChildren`
   awaits a single prefix-less `tmux.listSessions()`, groups by
   `terminalWorktreePrefix(worktreePath)`, sets each chevron, and **threads the
   grouped sessions into the Worktree nodes** so `getTerminalChildren` reads from
   that same call rather than re-listing per Worktree.

3. **Refine ADR-0007 §3, not reverse it.** Worktree rows now `await` one
   local `list-sessions` before painting. The `WorktreeListCache` and its
   background stale-while-revalidate are untouched — only the chevron now
   depends on a live call.

4. **Honor ADR-0014 in full.** The grouping is in-memory and per-render; no
   `globalState` key, no hand-invalidated mirror. tmux remains the single source
   of truth; `refresh()` re-lists.

## Consequences

- The bend on ADR-0007 §3 is nearly free: a default-expanded tree already fires
  a `list-sessions` per Worktree milliseconds after paint, so the synchronous
  benefit was largely gone. Net tmux calls drop to **1 per repo render** versus
  N-on-expand previously.
- Collapsing a Worktree that hosts Terminals does not stick — it re-expands on
  the next `refresh()`. Accepted (see Context). Persisting collapse would
  require an expansion store and is explicitly out of scope.
- An empty Worktree has no chevron; discoverability of adding a Terminal rests
  entirely on the hover/inline `+`.
- Adding the first Terminal flips a Worktree `None → Expanded` on `refresh()`;
  removing the last flips it back to `None`.

## Refines

- **ADR-0007 §3** — worktree render is no longer purely synchronous; it awaits
  one live `list-sessions`. The cache itself is unchanged.
- **ADR-0014** — reinforced: the chevron count is sourced live, no new persisted
  terminal state.

## Status

Accepted.

[vscode#127711]: https://github.com/microsoft/vscode/issues/127711
