# ADR-0003: Single-folder Repository switching via `vscode.openFolder`

## Context

ADR-0001 banned `vscode.openFolder` from the switch path because reloading the
window destroys in-memory extension state — Claude Code chat panels, terminal
sessions, language-server caches — which is exactly what we wanted to preserve.
ADR-0002 then built a multi-root architecture (N Repositories mounted as N workspace
roots, swap one slot in place) to keep switches reload-free.

Two things shifted that motivation:

1. **Live UX feedback.** Mounting every registered Repository as a workspace root
   makes the explorer (and search, SCM, file-picker) noisy — the user reports
   wanting "only one Repository active at a time."
2. **Workflow-specific reload cost.** The motivating losses ADR-0001 enumerated
   are handled out-of-band for this user's workflow: Claude Code runs in tmux
   (survives reload), and we have no other extension whose in-memory state we
   strictly need to preserve across switches. The remaining reload cost is a
   1–3s blip plus a brief language-server re-index.
3. **VS Code already implements per-worktree persistence.** Each opened folder
   gets its own `workspaceStorage/<hash>/` and Hot Exit slice — tabs, dirty
   buffers, cursor positions, splits, scroll, breakpoints all restore per
   folder, including across the per-worktree boundary (different worktree path
   = different workspace). That is precisely the per-Worktree `TabSnapshot`
   SwitchOperation envisioned, but free and more complete than we could build.

## Decision

A switch is a single call:

```text
activeWorktreeStore.set(commonDir, worktreePath)   // persist BEFORE reload
vscode.commands.executeCommand('vscode.openFolder', Uri.file(worktreePath), { forceNewWindow: false })
```

- The window reloads. The new folder becomes the sole workspace root.
- VS Code restores that folder's own session (tabs, dirty buffers, layout) from
  its workspace storage automatically.
- Deck's only persisted state is `deck.repositories` (registry) and
  `activeWorktrees` (the last worktree opened per Repository's common dir, so
  clicking a Repository node opens its last-active worktree).

There is no MountReconciliation, no WorkspaceRootPlanner, no resolveWorkspaceRoots,
no append-only invariant, no index-0 problem. Deck is now a **registry plus
launcher** with per-Repository worktree memory.

## Consequences

- **Reload per switch.** ~1–3s plus LS re-index. Accepted given workflow.
- **Extensions lose in-memory state on switch** unless they persist themselves.
  Out-of-band tools (tmux, external processes) are the supported pattern.
- **Tab and dirty-buffer persistence is automatic and per-Worktree** (different
  worktree path → distinct VS Code workspace identity).
- **The descoped per-worktree TabSnapshot feature is no longer needed** — VS
  Code's workspace storage is the implementation.
- Significant code deletion: `mountReconciliation.ts`, `workspaceRootPlanner.ts`,
  `resolveWorkspaceRoots.ts`, `snapshot/tabSnapshotStore.ts`, and their tests.
  `worktreeSwitcher.ts` collapses to a few lines.

## Supersedes

- ADR-0001 (no window reload). The no-reload guarantee is dropped; reload is
  the switch mechanism. The previously rejected `vscode.openFolder` call is now
  the canonical switch.
- ADR-0002 (registry-driven append-only mounting). The multi-root architecture
  and its index-0 caveat no longer apply.

## Status

Accepted.
