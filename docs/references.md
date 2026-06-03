# Reference projects

Reference repos live as **siblings** in `~/code/`. Local paths are tracked in `.agents/local-repos.json` (gitignored); the committed template is `.agents/local-repos.example.json`. File pointers below use the repo keys from that map, for example
`tabstronaut:src/extension.ts`.

## Index

| Reference | Role |
|---|---|
| **vscode-git-worktree-switcher** | The no-reload switching mechanic. `updateWorkspaceFolders` instead of `openFolder`. |
| **git-worktree-manager** | Feature-rich worktree tree view (21.5k installs). Reference for tree UX, context menu, command surface. |
| **vscode-project-manager** | 7.28M installs. Reference for multi-repo discovery and the "list of projects" UX in the Activity Bar. |
| **tabstronaut** | Manual tab snapshot/restore extension. Reference for the per-tab serialization we automate per-worktree. |
| **superset** | Electron + own pty-daemon. The over-architected predecessor; reference for PTY/terminal-runtime patterns that vscode-deck's per-worktree terminals will need to handle. |

## By subsystem

When you hit a problem, jump to the listed file rather than reading the whole repo.

### No-reload worktree switching

| File | What it teaches |
|---|---|
| `vscode-git-worktree-switcher:src/extension.ts` | The pattern that avoids window reload. |

### Tree view (multi-project + worktrees in one view)

| File | What it teaches |
|---|---|
| `git-worktree-manager:src/views/` | `TreeDataProvider` with project/work
tree hierarchy. |
| `vscode-project-manager:src/extension.ts` | Project list discovery, settings storage, quickpick switcher. |

### Tab snapshot mechanic

| File | What it teaches |
|---|---|
| `tabstronaut:src/` | `vscode.window.tabGroups` capture + `openTextDocument` + `showTextDocument` restore. The exact APIs we use. |

## Cloning fresh

These are not vendored. Clone as siblings of `vscode-deck/`:

```sh
cd ~/code
git clone --depth 1 https://github.com/tmokmss/vscode-git-worktree-switcher
git clone --depth 1 https://github.com/jackiotyu/git-worktree-manager
git clone --depth 1 https://github.com/alefragnani/vscode-project-manager
git clone --depth 1 https://github.com/jhhtaylor/Tabstronaut tabstronaut
git clone --depth 1 git@github.com:superset-sh/superset.git
```
