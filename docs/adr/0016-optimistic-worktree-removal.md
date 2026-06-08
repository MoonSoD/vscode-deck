# ADR-0016: WorktreeRemoval is optimistic, guarded by an in-memory pending set

## Context

`git worktree remove` deletes the working tree directory — an `rm -rf` of
everything the Worktree contains. For a large Worktree (`node_modules`, build
output, caches) that filesystem delete dominates: it can take tens of seconds.

Today `WorktreeRemovalCommand.run` awaits that delete *before* touching the UI
(`worktreeRemovalCommand.ts:113-135`): kill terminals → `await removeWorktree`
→ delete branch → `worktreeListCache.remove` → `refresh()`. The row the user
clicked "Remove" on stays on screen, fully interactive, for the entire delete.
The user already confirmed via a modal, status was inspected, and `force` was
computed — the outcome is decided — yet the sidebar pretends nothing happened
until the disk catches up.

The fix is optimistic UI: drop the row immediately, run the slow delete
detached. The tree is already built for this. `getWorktreeChildren` paints
synchronously from `worktreeListCache` (ADR-0007) and the cache *is* what the
user sees; `git worktree list` is only the eventual reconciler
(`projectTree.ts:197-210`).

But that same reconciler is a trap. Every render also kicks
`refreshWorktreesInBackground`, which runs real `git worktree list` and
overwrites the cache whenever it differs (`projectTree.ts:307-324`). So the
naive "remove from cache + refresh" races itself:

```
remove W from cache → refresh → row gone ✓
  → render triggers background git list → git STILL lists W (rm -rf unfinished)
  → cache overwritten with W → refresh → row reappears ✗
```

The optimistic removal would be undone, within the same frame, by the
stale-while-revalidate loop that makes the rest of the tree feel fast.

## Decision

1. **Split removal into a synchronous optimistic step and a detached
   background step.** On confirm, synchronously: resolve `commonDir` (cached,
   fast), clear the `activeWorktrees` entry if it matches, `worktreeListCache.remove`,
   and `refresh()`. The row vanishes instantly. Then, detached: kill terminals
   → `removeWorktree` → opt-in `deleteBranch`.

2. **Guard the optimism with a shared in-memory `pendingWorktreeRemovals:
   Set<string>` of Worktree paths.** It is injected into both
   `WorktreeRemovalCommand` (which adds on confirm, deletes on settle) and
   `ProjectTreeProvider` (which reads it). This mirrors the provider's existing
   `refreshingWorktrees` / `resolvingProjectPaths` guard sets — same shape, same
   lifetime, no new persistence concept.

3. **The provider filters pending paths in two places.** `toWorktreeNodes`
   excludes them so a cache that still lists W won't render it, and
   `refreshWorktreesInBackground` excludes them so the reconciler won't re-add W
   while its delete is in flight (`projectTree.ts:316`). This closes the race in
   the Decision-context diagram above: git can keep reporting W for as long as
   the `rm -rf` runs; the tree ignores it until the path leaves the set.

4. **Rollback rides the reconciler, for free.** On background **failure**: drop
   W from the pending set, re-add it to the cache, `refresh()` (the row returns),
   and `showErrorMessage('Cannot remove worktree: …')` — the same surface and
   wording removal errors already use (`worktreeRemovalCommand.ts:119`). Because
   git still lists a Worktree it failed to delete, the reconciler would restore
   the row on its own once the path is un-suppressed; re-adding to the cache just
   makes it immediate.

5. **No refresh on success.** When the delete completes, drop W from the pending
   set and stop. Cache and git already agree that W is gone, so a refresh would
   only risk a flicker. Branch-deletion failure keeps its own existing toast and
   does not bring the row back (the Worktree *was* removed).

## Considered options

- **Undo toast (Gmail-style), rejected.** Undo *delays* the destructive action
  to open a cancel window; it does not reduce latency, and a half-finished
  `rm -rf` cannot be cleanly cancelled. The confirmation modal already gates the
  destruction, so a post-hoc undo is redundant friction. Wrong tool for a
  latency problem.

- **"Removing…" spinner row, rejected.** Keep the row, dim it, show a
  `loading~spin` icon until git finishes. Honest, but the user still *watches*
  the row for the full delete — it does not fix perceived latency, which is the
  whole point.

- **Persisted pending set + resume-on-activation, rejected (for now).** Mirror
  `pendingTerminalOpenStore`: write pending paths to a memento and re-issue
  unfinished removals on the next activation. This would survive the one edge the
  in-memory set does not — reloading or quitting the window *during* the
  few-second delete window, after which the cache excludes W but git may still
  report a half-deleted directory, so the row reappears. Rejected as
  disproportionate: the edge is rare, self-correcting (the user removes again,
  now fast because most files are already gone), and the persistence would add an
  activation hook and a test surface for a case nobody hits. The in-memory `Set`
  is the whole mechanism.

- **Silent reappear on failure, rejected.** Bringing the row back with no message
  leaves the user wondering why it returned. Rollback must be communicated.

## Consequences

- Removing a large Worktree feels instant: confirm → row gone → user moves on,
  while the `rm -rf` runs detached.
- A new piece of shared mutable state (`pendingWorktreeRemovals`) couples the
  removal command and the tree provider. It is in-memory and best-effort: a
  window reload mid-delete loses it, and the row may transiently reappear (see
  the rejected persisted option). Acceptable and self-correcting.
- Removal errors now surface *after* the user has visually moved on. The toast
  still names the Worktree and reason; the row returns. This is the standard
  optimistic-UI trade: instant success path, slightly louder failure path.
- Two filter points (`toWorktreeNodes`, `refreshWorktreesInBackground`) must stay
  in sync with the pending set. If a future change adds a third path that
  materialises Worktree rows, it must consult the set too, or the race returns.

## Refines

- ADR-0007. The `globalState` worktree-list cache and its stale-while-revalidate
  reconciler are unchanged; this ADR adds a suppression set so optimistic
  mutations survive a reconcile round-trip. The cache remains the paint source
  and git remains the eventual truth.

## Status

Accepted.
