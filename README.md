<p align="center">
  <img src="https://raw.githubusercontent.com/a9a4k/vscode-deck/main/icon.png" width="128" alt="Deck icon">
</p>

<h1 align="center">Deck</h1>

<p align="center">
  <b>A home in VS Code for the coding agents you run across git worktrees — persistent terminals keep each one alive, and Deck taps you the moment an agent needs you.</b>
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=a9a4k.deck"><img src="https://img.shields.io/visual-studio-marketplace/v/a9a4k.deck?label=Marketplace" alt="Marketplace version"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=a9a4k.deck"><img src="https://img.shields.io/visual-studio-marketplace/i/a9a4k.deck?label=Installs" alt="Installs"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=a9a4k.deck"><img src="https://img.shields.io/visual-studio-marketplace/r/a9a4k.deck?label=Rating" alt="Rating"></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license"></a>
</p>

<!-- HERO GIF — capture and save to docs/images/hero.gif. Suggested shot: the Deck
     tree in the secondary sidebar with two worktrees, Claude Code in one and Codex
     in the other; one row shows "working" while the other flips to "needs input"
     and raises a notification. ~15-20s, looped. -->

![Deck in action](https://raw.githubusercontent.com/a9a4k/vscode-deck/main/docs/images/hero.gif)

> **Install:** open the Extensions sidebar (`Cmd/Ctrl+Shift+X`), search **Deck**, click Install. Then open **Deck** from the secondary sidebar.

Deck adds a **Repositories & Worktrees** tree to VS Code's secondary sidebar and gives every worktree its own **persistent terminals**. Run **Claude Code** or **Codex** in them across as many worktrees as you like — the terminals keep your agents alive through window reloads and reboots, and Deck shows each agent's status on its tree row, so you're tapped the moment one needs you instead of hunting across windows.

It's not another app to leave your editor for. Deck closes two gaps VS Code leaves open — working across **multiple repos and worktrees at once**, and **terminals that persist** instead of dying on every reload — right in the sidebar you already have open.

## Features

### See every repo and worktree in one tree

A unified **Repositories & Worktrees** tree lives in the secondary sidebar — register your repos once and every worktree shows up under them. Click a worktree to open it in this window, or open it in a new window to work on several at the same time. The tree stays put across switches, so you never lose your map of what's where.

<!-- SCREENSHOT — the Repositories & Worktrees tree with a few repos expanded.
     Save to docs/images/tree.png -->
![Repositories & Worktrees tree](https://raw.githubusercontent.com/a9a4k/vscode-deck/main/docs/images/tree.png)

### Persistent per-worktree terminals

Each worktree gets its own terminals, opened as **editor tabs** (not crammed in the bottom panel) so you can `Ctrl+Tab` between them like any other tab. A dedicated tmux server keeps them alive in the background — but **you never touch tmux**: no prefix keys, no status bar, just a normal VS Code terminal, the same way iTerm2 uses tmux under the hood. A terminal is durable like a file — its tab is just a view onto it:

- **Close the tab** — the terminal keeps running; reopen its row anytime.
- **Open it in two windows at once** — both are live views of the same terminal; type in one and it shows in the other.
- **Switch worktree or reload the window** — terminals reattach with whatever's running *still running*, untouched.
- **Reboot, crash, or `kill-server`** — terminals come back at their working directory with scrollback, and your **Claude Code / Codex sessions resume mid-conversation** (`claude --resume` / `codex resume`). Plain shells return to a fresh prompt.

<!-- GIF — close a terminal tab / reload the window, reopen, scrollback intact.
     Save to docs/images/terminals.gif -->
![Persistent terminals](https://raw.githubusercontent.com/a9a4k/vscode-deck/main/docs/images/terminals.gif)

### Agent status in the tree

Run **Claude Code** or **Codex** in a worktree's terminal and Deck reads its status straight from the agent — **working**, **needs input**, **done**, or **failed** — and shows it on the tree row, **labeled with what that agent is working on** (pulled from the agent's own task summary) so a dozen concurrent agents stay distinguishable at a glance. Run several at once and only step in when one actually needs you: optional notifications fire when an agent asks a question or finishes a turn, and stay quiet while you're already looking at that terminal's tab. Deck only *observes* — you start and drive the agents; it gives them a durable home and a status light. (The agent status and notification are shown in the demo at the top.)

### One-click terminal launchers

Save a command as a launcher — your agent with its usual flags, or a project bootstrap — and start a terminal running it in one click. Define launchers **per user** (global), **shared with your team** (committed to `<worktree>/.deck/launchers.json`), or **personal to one repo**. Flip **run on worktree create** and Deck fires them automatically when you add a worktree through it, so a fresh worktree can bootstrap itself and kick off an agent without you typing a thing.

## Getting started

1. Install Deck and open it from the **secondary sidebar**.
2. **Add Repository** → pick a folder that contains git worktrees.
3. Click a worktree to switch the active folder to it.
4. Click **+** on a worktree to open a terminal; start your agent in it.

## Requirements

- **VS Code 1.110+**
- **tmux ≥ 3.1** on your `PATH` — required for the persistent terminals only. Deck drives an isolated tmux server of its own (separate from your personal tmux) entirely for you; you never run a tmux command. Without tmux, worktree switching still works and the terminal UI is hidden.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `deck.confirmTerminalDelete` | `true` | Ask for confirmation before deleting a terminal. |
| `deck.notifyOnNeedsInput` | `true` | Notify when an agent needs input (suppressed while you're viewing that terminal). |
| `deck.notifyOnCompleted` | `true` | Notify when an agent completes a turn (suppressed while you're viewing that terminal). |
| `deck.agentResumeTemplates.claude` | — | Claude Code command template Deck uses to resume a session. Include `{id}` for the session id. |
| `deck.agentResumeTemplates.codex` | — | Codex command template Deck uses to resume a session. Include `{id}` for the session id. |
| `deck.tmux.automaticRenameFormat` | — | tmux automatic-rename format for Deck terminals. |

## FAQ

**Is it free / open source?** Yes — MIT licensed. Source: [github.com/a9a4k/vscode-deck](https://github.com/a9a4k/vscode-deck).

**Which agents work with Deck?** The terminals run any command or agent. Status, notifications, and session resume currently support **Claude Code and Codex**, via hooks Deck installs in their config.

**Do I have to use AI agents?** No. The worktree tree and persistent terminals are useful on their own; agent status is just a bonus when you do run agents in them.

**Does switching worktrees reload the window?** Yes, briefly (~1–3s) — but nothing is lost. Your terminals and the agents in them live outside VS Code on tmux, and VS Code restores that worktree's own tabs, unsaved edits, and layout automatically.

**Does it send telemetry?** No.

**Where does agent status get stored?** In disposable files under `~/.local/share/deck/status/` (with read markers in the sibling `status-reads/`). Delete both directories to fully reset agent status; Deck prunes orphan markers on the next reload.

## Contributing

```sh
git clone https://github.com/a9a4k/vscode-deck
cd vscode-deck
npm install
npm run build
# Press F5 in VS Code (uses .vscode/launch.json) to launch a dev host.
```

More for contributors:

- [AGENTS.md](./AGENTS.md) — agent / contributor working principles
- [CONTEXT.md](./CONTEXT.md) — domain glossary and component map
- [docs/references.md](./docs/references.md) — reference repos under `references/`
- [docs/adr/](./docs/adr/) — architectural decisions

## License

[MIT](./LICENSE)
