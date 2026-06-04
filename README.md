# Deck

A VS Code extension that hosts a unified
**Projects & Worktrees** tree in the Activity Bar, switches worktrees in
one window without reload, and restores per-worktree tab snapshots.\

## Quick start

```sh
cd vscode-deck
npm install
npm run build
# Then press F5 in VS Code (uses .vscode/launch.json) to launch a dev host.
```

In the dev host: open the **Deck** Activity Bar icon → "Add Project" →
pick a folder with git worktrees → click a worktree to switch.

## Docs

- [AGENTS.md](./AGENTS.md) — agent / contributor working principles
- [CONTEXT.md](./CONTEXT.md) — domain glossary and component map
- [docs/references.md](./docs/references.md) — reference repos under `references/`
- [docs/adr/](./docs/adr/) — architectural decisions
