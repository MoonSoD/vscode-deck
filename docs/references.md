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
| **iterm2** | The canonical tmux control-mode (`-C`) client. Reference for the protocol handling behind ADR-0012: reply correlation, %output decoding, history seeding, flow control. |
| **tmux** | The server side of ADR-0012's transport. Ground truth for what the control-mode protocol actually emits and accepts — read this instead of guessing from client behavior. |
| **tmux-resurrect** | The save/restore engine vendored for ADR-0019. Ground truth for what `save.sh`/`restore.sh` actually do — the `cat <file>; exec <shell>` content-restore mechanism, the `@resurrect-processes` / `@resurrect-capture-pane-contents` knobs — read this instead of guessing from plugin docs. |

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

### Reboot-surviving terminals (ADR-0019)

| File | What it teaches |
|---|---|
| `sanctel:src-tauri/src/restore_runtime.rs` | The `anchor → restore.sh → kill-anchor` launch sequence, periodic-save timer (`start_periodic_save(300)`), and save-on-exit — the working implementation ADR-0019 mirrors. |
| `sanctel:docs/design/spikes/restore-feasibility.md` | Why continuum is dropped (the `another_tmux_server_running` short-circuit) and resurrect's `save.sh`/`restore.sh` are driven directly; measured save/restore timings. |
| `sanctel:app-bundle/sanctel.tmux.conf` | The templated-conf shape (`__…__` placeholders) and resurrect knobs Deck adapts for `globalStorage/deck.conf`. |
| `tmux-resurrect:scripts/save.sh` | What a save touches — `list-panes`/`list-windows` metadata plus one `capture-pane -epJ` per pane (why a save never freezes panes). |
| `tmux-resurrect:scripts/restore.sh` | Content restore via `cat <file>; exec <default-command>` (line ~123) — the sequential pipeline that composes cleanly with ADR-0012 §5's seed. |
| `tmux-resurrect:resurrect.tmux` | The `run-shell` entry point and the `@resurrect-*-script-path` options Deck deliberately bypasses (it calls the scripts with the current path). |
| `tmux-resurrect:docs/restoring_programs.md` | `@resurrect-processes 'false'` = restore no programs (Deck's "shells only"). |

### tmux control mode (ADR-0012 transport)

| File | What it teaches |
|---|---|
| `iterm2:sources/tmux/TmuxGateway.m` | Control-mode protocol parsing: %begin/%end/%error correlation, %output octal decoding, notification dispatch, %pause/%continue flow control. The battle-tested counterpart to `TmuxControlClient`. |
| `iterm2:sources/tmux/TmuxController.m` | Session/window lifecycle over the gateway: attach/detach, resize strategy (`window-size` handling), command batching. |
| `iterm2:sources/tmux/TmuxHistoryParser.m` | Seeding scrollback from tmux history into the terminal buffer — iTerm2's equivalent of our capture-pane seed. |
| `tmux:control.c` | What the server writes to a `-C` client: %output octal escaping (`control_write_output`), %begin/%end/%error block emission, pause-mode offsets. |
| `tmux:control-notify.c` | Every `%`-notification the server can emit (%window-add, %session-changed, …) — the complete list our parser must tolerate. |
| `tmux:cmd-send-keys.c` | The `-H` literal-byte path our `sendKeys` rides (`args_has 'H'` → `KEYC_LITERAL`). |
| `tmux:cmd-capture-pane.c` | Exact semantics of the seed flags `-p -e -q -J -N -S`. |
| `tmux:cmd-parse.y` | The command grammar whose yacc stack depth caps send-keys at <16384 args (why we chunk at 4096). |

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
git clone --depth 1 https://github.com/gnachman/iTerm2 iterm2
git clone --depth 1 https://github.com/tmux/tmux
git clone --depth 1 https://github.com/tmux-plugins/tmux-resurrect
```
