# ADR-0002: Registry-driven, append-only root mounting

## Context

Deck has a persistent registry of Projects (`deck.projects`, like
vscode-project-manager) but must mount and switch them **without reloading the
window** (ADR-0001, like vscode-git-worktree-switcher). Neither reference does
both: project-manager opens projects via `vscode.openFolder` (reloads), and
worktree-switcher has no registry — the open workspace folders *are* its truth.

`vscode.workspace.updateWorkspaceFolders` reloads the window only when it
touches **index 0** of the folder list (and on the empty → first-folder
transition). Appending at the end and replacing a non-zero slot are both
reload-free. These are our two primitives:

- **append** — `updateWorkspaceFolders(len, null, …)` (from project-manager's
  `addProjectPathToWorkspace`)
- **swap-in-place** — `buildRepoFocusSwap` + `focusOn` (from
  vscode-git-worktree-switcher)

## Decision

Deck is **registry-driven with append-only mounting**:

1. `deck.projects` is the registry; Project identity is the git common dir
   (ADR/CONTEXT), the stored path is a discovery seed.
2. On activation, **reconcile toward the registry**: append (never insert at
   index 0) every registered Project's stored ActiveWorktree that isn't already
   mounted, in one atomic `updateWorkspaceFolders` call.
3. **Add Project** mounts immediately by appending.
4. **Switch** replaces the matching non-zero slot via `buildRepoFocusSwap`.
5. Adopt worktree-switcher's recovery pass for worktrees deleted out from under
   a mounted root.

### The index-0 problem

Something must occupy index 0, and switching *that* Project reloads. We accept
this (**option a**): whichever Project lands at index 0 pays a reload on switch;
every other Project switches reload-free.

Rejected: a Deck-owned **sentinel folder pinned at index 0** inside a saved
`.code-workspace`, which would make *every* real Project non-zero and switchable
with zero reloads. Rejected for v1 because it forces a workspace file and adds a
junk root for a cost (one Project's switch reloads) we expect to be tolerable.
Revisit if that reload proves annoying.

## Consequences

- The empty-window → first-mount transition reloads once (unavoidable without
  the sentinel approach).
- Switching the index-0 Project reloads; all others do not. UX should make this
  predictable (e.g. don't reorder roots unexpectedly).
- Deck must reconcile two sources that can disagree (`deck.projects` vs
  `workspace.workspaceFolders`) on every activation.

## Status

Accepted.
