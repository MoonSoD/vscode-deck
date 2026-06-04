# Deck Context

A VS Code extension that surfaces multiple git repositories' worktrees in
one Activity Bar view and switches between them by opening one folder at a
time. VS Code handles tab/dirty-buffer/layout persistence per opened folder.

## Vocabulary

| Term | Meaning |
|---|---|
| **Project** | A git repository the user has registered with Deck, identified by its **git common dir** (`git rev-parse --git-common-dir`) — the one directory all of a repo's worktrees share. Each Project owns N Worktrees. The absolute path stored in user settings (`deck.projects`) is a **discovery seed**, not the identity: it's whichever worktree was checked out at registration, used to rediscover the repo across reloads. |
| **Worktree** | A `git worktree` entry inside a Project. Discovered by `git worktree list --porcelain`. Identified by its filesystem path. |
| **ActiveWorktree** | The Worktree last opened for a Project. Persisted per Project (`{ commonDir → worktreePath }` in `globalState`), so clicking a Project node opens that worktree again. Only one workspace folder is ever mounted at a time. |
| **ActiveProject** | The Project whose ActiveWorktree is the current workspace folder. Derived from `workspace.workspaceFolders[0]` by resolving its common dir against the registry. Not persisted — VS Code is the source of truth. |
| **SwitchOperation** | A switch is one call: persist `ActiveWorktree[commonDir] = targetPath`, then `vscode.openFolder(Uri.file(targetPath))`. The window reloads; VS Code restores that folder's own session (tabs, dirty buffers, splits, breakpoints) from its per-folder workspace storage. See [ADR-0003](./docs/adr/0003-single-folder-switching-via-openfolder.md). |
| **WorktreeRemoval** | Runs `git worktree remove <path>` (optionally `--force` when the worktree has uncommitted changes), and — only when the user opts in via a checkbox in the confirm dialog — also runs `git branch -d <branch>` afterwards. The branch-deletion checkbox's last value is remembered per-user. Mirrors superset's pattern; deliberately keeps branch and worktree as separate ref-counted things by default. |
| **ProjectRemoval** | Delists a Project from `deck.projects` and clears its per-Project Deck state (ActiveWorktree entry and remembered worktree root). Does **not** touch the git repository, its worktrees, or their files. The inverse of "Add Project." |
| **WorktreeOrder** | The user-curated display order of Worktrees within a Project. Persisted per Project (`{ commonDir → orderedWorktreePaths[] }` in `globalState`). Reconciled lazily against `git worktree list`: unknown paths appended to the bottom, stale paths dropped. Projects without an entry render in git's order until the user drags. Project order is **not** stored separately — the `deck.projects` setting array is itself the order. |

## Components

```
┌──────────────────────────────────────────────────────────┐
│  Activity Bar: "Deck"                                    │
│  ┌────────────────────────────────────────────────────┐  │
│  │  Projects & Worktrees (TreeView)                   │  │
│  │  ├── ProjectA  ●  ← marker = ActiveProject         │  │
│  │  │   ├── main  ✓  ← marker = ActiveWorktree        │  │
│  │  │   ├── feature/x   ← click = SwitchOperation     │  │
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
- `src/tree/worktreeTreeItem.ts` — pure label/icon derivation
- `src/git/worktrees.ts` — `git worktree list --porcelain` parsing, common-dir resolution
- `src/switch/activeWorktreeStore.ts` — `{ commonDir → worktreePath }` map in `globalState`
- `src/switch/worktreeSwitcher.ts` — persist + `vscode.openFolder`

## Relationships

- **Project → Worktree.** One-to-many. Discovered fresh each time the tree expands.
- **Project → ActiveWorktree.** One-to-one persistent. Keyed by Project's git common dir.
- **Workspace folder → ActiveProject.** Derived at read time. There is at most one mounted folder (or none, on a brand-new window).
- **SwitchOperation persists the new ActiveWorktree before reload**, so the persisted state is correct after the extension host restarts.

## Out of scope (deliberately, for now)

- **Per-worktree terminals (tmux-backed).** Out-of-band today; users run agents in tmux to survive reloads.
- **Per-worktree agent chat session.** TBD.
- ~~**Multi-root mounting.**~~ Rejected by ADR-0003: one folder is mounted at a time. Multi-root + a per-Project `MountReconciliation` were explored in ADR-0002 (now superseded).
- ~~**Per-worktree tab snapshot/restore.**~~ Provided by VS Code: each folder URI has its own workspace storage, so tabs, dirty buffers, layout, cursor positions all restore per Worktree automatically.
- ~~**No-window-reload switch.**~~ Rejected by ADR-0003 (supersedes ADR-0001): reload is the switch mechanism. Acceptable because the original motivation (preserving in-memory extension state) is handled out-of-band by the workflow.

## Reference repos

See [docs/references.md](./docs/references.md). The two most load-bearing under ADR-0003:

- `references/vscode-project-manager` — the `vscode.openFolder` registry-and-launcher pattern.
- `references/git-worktree-manager` — tree UX over `git worktree list`.
