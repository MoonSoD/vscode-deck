# ADR-0001: Switching worktrees must not reload the window

## Context

VS Code reloads its window — restarting every extension host — whenever
the opened folder changes via `vscode.openFolder`. A reload is ~1–3s of
cold-start, and it destroys in-memory state in every extension. For a
worktree-switching UX, this kills the "feels like one app" illusion that
distinguishes Deck from `code <folder>`.

## Decision

Worktree switching MUST use only APIs that do not reload the window:

- `vscode.workspace.updateWorkspaceFolders(...)` to mount/unmount roots
- `vscode.window.tabGroups.close(...)` to close tabs
- `vscode.workspace.openTextDocument` + `vscode.window.showTextDocument` to restore tabs

Calling `vscode.commands.executeCommand('vscode.openFolder', ...)` from
the switch code path is a regression and review must reject it.

## Consequences

- We can't use VS Code's folder concept as our Worktree concept directly.
  Instead, the extension keeps Worktrees mounted as workspace roots (or
  swaps them via `updateWorkspaceFolders`) and treats "ActiveWorktree" as
  its own concept layered on top.
- Per-folder `.vscode/launch.json` etc. require the multi-root approach.
- The trade-off is one of fidelity: things VS Code automatically scopes
  per opened folder (search, SCM grouping) now require explicit handling
  in the extension.

## Status

Accepted.
