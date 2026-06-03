# Deck Context

A VS Code extension that surfaces multiple git repositories' worktrees in
one Activity Bar view, switches between them in a single window without
reload, and preserves per-worktree editor tab state.

## Vocabulary

| Term | Meaning |
|---|---|
| **Project** | A git repository the user has registered with Deck. Each Project owns N Worktrees. Stored in user settings (`deck.projects`) as absolute paths. |
| **Worktree** | A `git worktree` entry inside a Project. Discovered by `git worktree list --porcelain`. Identified by its filesystem path. |
| **ActiveWorktree** | The Worktree currently mounted as a Project's workspace root. Exactly one **per Project** — each registered Project contributes one root, and that root is the Project's ActiveWorktree. Stored in global settings, keyed by Project. |
| **TabSnapshot** | The set of `{uri, viewColumn, pinned, active}` for all text editor tabs at a moment. Persisted per Worktree in `globalState`. |
| **SwitchOperation** | An atomic transition for one Project: capture current TabSnapshot → close that Project's tabs → swap the Project's workspace root in place to the target Worktree via a single `updateWorkspaceFolders(0, n, ...allRoots)` call (other Projects' roots preserved) → load target's TabSnapshot → update the Project's ActiveWorktree. |

## Components

```
┌──────────────────────────────────────────────────────────┐
│  Activity Bar: "Deck"                                │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Projects & Worktrees (TreeView)                   │  │
│  │  ├── ProjectA                                      │  │
│  │  │   ├── main           ← click = SwitchOperation │  │
│  │  │   ├── feature/x                                 │  │
│  │  │   └── bugfix/y                                  │  │
│  │  └── ProjectB                                      │  │
│  │      ├── main                                      │  │
│  │      └── refactor                                  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

Code layout:

- `src/extension.ts` — activation, command registration
- `src/tree/projectTree.ts` — TreeDataProvider for Projects & Worktrees
- `src/git/worktrees.ts` — `git worktree list --porcelain` parsing
- `src/snapshot/tabSnapshotStore.ts` — capture/load TabSnapshot per Worktree
- `src/switch/worktreeSwitcher.ts` — orchestrates SwitchOperation

## Relationships

- **Project → Worktree.** One-to-many. Discovered fresh each time the tree expands.
- **Worktree → TabSnapshot.** One-to-one persistent. Keyed by absolute worktree path.
- **ActiveWorktree → TabSnapshot.** The current window's tabs are the materialization of `ActiveWorktree`'s TabSnapshot.
- **SwitchOperation reads previous ActiveWorktree, captures, then writes new ActiveWorktree.** Failure modes (missing files, dirty buffers) handled by the switcher, not callers.

## Out of scope (deliberately, for now)

These are planned but not in the skeleton. Each gets a design doc before code.

- **Per-worktree terminals (tmux-backed).** Designed in
  [docs/design/terminal-runtime.md](./docs/design/terminal-runtime.md) — TBD.
- **Per-worktree agent chat session.** TBD.
- ~~**Multi-root mounting.**~~ **Resolved: one root per Project, swapped in place.**
  Each registered Project contributes exactly one workspace root; SwitchOperation
  swaps that Project's root via a single `updateWorkspaceFolders(0, n, ...allRoots)`
  call, preserving every other Project's root. Swapping a non-first root is what
  keeps switching reload-free (a first-root change restarts the extension host).
  Mirrors vscode-git-worktree-switcher's `focusOn`/`buildRepoFocusSwap`.
  See [docs/adr/0001-no-window-reload.md](./docs/adr/0001-no-window-reload.md).

## Reference repos

See [docs/references.md](./docs/references.md). The two most load-bearing:

- `references/vscode-git-worktree-switcher` — the no-reload switch mechanic.
- `references/tabstronaut` — the tab snapshot mechanic we're automating.
