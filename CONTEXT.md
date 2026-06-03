# Deck Context

A VS Code extension that surfaces multiple git repositories' worktrees in
one Activity Bar view, switches between them in a single window without
reload, and preserves per-worktree editor tab state.

## Vocabulary

| Term | Meaning |
|---|---|
| **Project** | A git repository the user has registered with Deck, identified by its **git common dir** (`git rev-parse --git-common-dir`) — the one directory all of a repo's worktrees share. Each Project owns N Worktrees. The absolute path stored in user settings (`deck.projects`) is a **discovery seed**, not the identity: it's whichever worktree was checked out at registration, used to rediscover the repo across reloads. Mirrors `vscode-git-worktree-switcher`'s `commonDir`-based matching. |
| **Worktree** | A `git worktree` entry inside a Project. Discovered by `git worktree list --porcelain`. Identified by its filesystem path. |
| **ActiveWorktree** | The Worktree currently mounted as a Project's workspace root. Exactly one **per Project** — each registered Project contributes one root, and that root is the Project's ActiveWorktree. Stored in global settings, **keyed by Project common dir** (the path can change on every switch, so it can't be the key). |
| **TabSnapshot** | The set of `{uri, viewColumn, pinned, active}` for all text editor tabs at a moment. Persisted per Worktree in `globalState`. |
| **SwitchOperation** | An atomic transition for one Project: capture current TabSnapshot → close that Project's tabs → swap the Project's workspace root in place to the target Worktree via a single `updateWorkspaceFolders(0, n, ...allRoots)` call (other Projects' roots preserved) → load target's TabSnapshot → update the Project's ActiveWorktree. Reload-free **unless** the swapped slot is index 0 (see ADR-0002). |
| **MountReconciliation** | On activation, the pass that makes `workspace.workspaceFolders` match the `deck.projects` registry: each registered Project's stored ActiveWorktree is **appended** if not already mounted (append never touches index 0 → reload-free), in one atomic call. Deck is registry-driven; the workspace is reconciled toward the registry, not the reverse. See ADR-0002. |
| **Recovery** | The pass (borrowed from vscode-git-worktree-switcher) that detects a mounted root whose worktree was deleted out from under Deck and restores it to the Project's main worktree. |

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

- **Per-worktree tab snapshot/restore.** Deferred past v1. v1's SwitchOperation
  is pure root-swapping (no tab capture/close/restore). When added: root-prefix
  attribution of tabs to Projects, unscoped tabs left untouched, `TabInputText`
  only first (notebooks/diffs are known gaps).
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
