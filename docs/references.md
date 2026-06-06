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
| **vscode** | microsoft/vscode source. Reference for VS Code API internals — verifying contribution-point gates (e.g. `secondarySidebar`), built-in command names, and how VS Code itself implements tree views, view containers, and walkthroughs. |
| **sanctel** | Tauri + tmux Arc-shaped workspace. Reference for per-worktree PTY/tmux persistence patterns and multi-context workspace UX (profiles / spaces / tabs / agent flows). |

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

### VS Code API behavior & contribution points

| File | What it teaches |
|---|---|
| `vscode:src/vs/workbench/api/common/extHostApiCommands.ts` | Built-in command names extensions can invoke (e.g. `workbench.action.toggleAuxiliaryBar`). |
| `vscode:src/vs/workbench/api/common/configurationExtensionPoint.ts` | How contribution-point gates work; useful when verifying when a contribution became stable. |

### PTY / per-worktree terminal persistence

| File | What it teaches |
|---|---|
| `sanctel:src-tauri/src/` | tmux-backed PTY persistence wired to a workspace shell. Lighter-weight alternative to `superset`'s pty-daemon. |
| `sanctel:src/` | Profiles / spaces / tabs UX over a workspace surface — adjacent UX for multi-worktree agent flows. |

## Cloning fresh

These are not vendored. Clone as siblings of `vscode-deck/`:

```sh
cd ~/code
git clone --depth 1 https://github.com/tmokmss/vscode-git-worktree-switcher
git clone --depth 1 https://github.com/jackiotyu/git-worktree-manager
git clone --depth 1 https://github.com/alefragnani/vscode-project-manager
git clone --depth 1 https://github.com/jhhtaylor/Tabstronaut tabstronaut
git clone --depth 1 git@github.com:superset-sh/superset.git
git clone --depth 1 https://github.com/microsoft/vscode
git clone --depth 1 git@github.com:sanctel/sanctel.git
```
