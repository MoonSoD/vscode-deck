# Deck

A VS Code extension that gives each git worktree a persistent workspace from the
secondary sidebar: a unified **Repositories & Worktrees** tree to switch between
worktrees in one window without reloading, and **persistent per-worktree
terminals** that survive switches, reloads, and reboots.

## Quick start

```sh
cd vscode-deck
npm install
npm run build
# Then press F5 in VS Code (uses .vscode/launch.json) to launch a dev host.
```

In the dev host: open **Deck** from the secondary sidebar -> "Add Repository" ->
pick a folder with git worktrees -> click a worktree to switch.

## Terminals

Each worktree gets its own persistent terminals, listed under the worktree in the
Deck tree and opened as **editor tabs** (not the bottom panel). Click **+** on a
worktree to add one, click a row to open it, and right-click -> **Delete
Terminal** (or `cmd+backspace` on a focused row) to destroy it.

A terminal is durable like a file — its tab is just a view onto it:

- **Close the tab** — the terminal keeps running; reopen its row anytime.
- **Switch worktree / reload the window** — terminals reattach with their
  scrollback intact.
- **Reboot or crash** — terminals come back on the next launch at their working
  directory and with their scrollback. Whatever was *running* is not relaunched;
  you get a fresh shell prompt. (A snapshot is saved periodically and on close.)

Terminals run on an isolated tmux server dedicated to Deck (separate from your
personal tmux), so they require **tmux ≥ 3.1** on your `PATH`. Without it the rest
of Deck still works and the terminal UI is hidden.

## Docs

- [AGENTS.md](./AGENTS.md) — agent / contributor working principles
- [CONTEXT.md](./CONTEXT.md) — domain glossary and component map
- [docs/references.md](./docs/references.md) — reference repos under `references/`
- [docs/adr/](./docs/adr/) — architectural decisions
