# ADR-0007: Worktree list cached in globalState for instant render

## Context

After ADR-0006 closes the activation gap (Deck activates on `onView` rather
than `onStartupFinished`), `getWorktreeChildren` becomes the remaining visible
latency. Every Repository expansion shells out to `git worktree list --porcelain`
— ~80–200ms per Repository on macOS, dominated by process spawn rather than git
itself. Comparing to VS Code's built-in Explorer (which renders synchronously
from `workspace.workspaceFolders`), Deck shows a "loading" spinner under each
Repository on every cold start.

The same shape applies to `git rev-parse --git-common-dir`. Four sites in
`repositoryTree.ts` call it: `hasRegisteredCommonDir` (AddRepository path),
`resolveActiveRepository` (per refresh), `resolveRepositoryCommonDir` (per Repository),
and `getWorktreeChildren` (per Repository on expand). These are fire-and-forget
relative to the synchronous render path, but they fire `onDidChangeTreeData`
when they resolve — causing a post-paint flicker where Repositories briefly
render without active-marker styling, then re-render with it.

Alternatives considered:

- **In-memory cache only.** Survives switches within a window but resets on
  every reload. Doesn't help the cold-start case ADR-0006 just sharpened.
- **`workspaceState` cache.** Wrong scope — keyed per workspace folder URI,
  so each worktree gets its own cache and reload into a sibling worktree
  starts cold.
- **`FileSystemWatcher` on `.git/worktrees/`.** Over-engineering until a
  staleness bug is proven; porcelain parsing is cheap enough to retry on
  every `getChildren`.
- **Skip the cache, ship ADR-0006 alone.** Closes the largest gap but leaves
  the spinner-per-Repository, which is the gap users actually notice after the
  activation gap goes away.

## Decision

1. **WorktreeListCacheStore.** New `globalState`-backed store, keyed by
   `commonDir → Worktree[]`. Mirrors `WorktreeOrderStore`'s shape and
   lifecycle.

2. **Hydration.** On `activate()`, the store loads the full cache map into
   memory synchronously (VS Code's `globalState.get` is sync).
   `RepositoryTreeProvider` receives the store via constructor injection,
   identical pattern to `WorktreeOrderStore`.

3. **Synchronous render.** `getWorktreeChildren` returns cached `Node[]`
   synchronously when the cache is warm for the Repository's common-dir. A
   background refresh fires asynchronously, runs `git worktree list`,
   updates the cache, and emits `onDidChangeTreeData` only when the result
   differs from the cached value. Stale-while-revalidate.

4. **Cold cache.** First-ever activation per Repository still shells out
   asynchronously and shows a loading spinner for that Repository only. Once
   the result lands in the cache, every subsequent activation across all
   windows renders it synchronously.

5. **Cache shape.** Full `Worktree` objects (path, branch, detached, locked,
   prunable, bare) — matching what `WorktreeNode`'s constructor consumes.
   Trimming would force a re-shellout on first render to fill in the missing
   fields, defeating the cache.

6. **Invalidation.** Two triggers:
   - **Explicit synchronous mutation** on `AddWorktreeCommand` and
     `WorktreeRemovalCommand` success — the same commands already mutate
     `WorktreeOrderStore`, mirroring the call sites.
   - **Background refresh** on every `getChildren` call. Cheap; covers
     out-of-VS-Code mutations (e.g. `git worktree add` from a terminal).
   No `FileSystemWatcher` until proven necessary.

7. **Versioning.** Cache entries carry a `schemaVersion` field. On a Deck
   upgrade that changes `Worktree`'s shape, mismatched versions are treated
   as cold cache (re-shellout). Prevents replaying a stale shape on schema
   evolution.

8. **RepositoryCommonDirCache.** Sibling store with identical pattern, keyed
   `repositoryPath → commonDir`. Closes the post-paint marker flicker by
   resolving common-dirs synchronously from cache when warm, refreshing in
   the background, emitting `onDidChangeTreeData` only on diff. Same
   invalidation and versioning rules.

## Mechanics

- Both caches live alongside `WorktreeOrderStore` and `ActiveWorktreeStore`
  under `src/`. No new top-level directory.
- The four `git rev-parse --git-common-dir` call sites in `repositoryTree.ts`
  are routed through `RepositoryCommonDirCache`. The `getCommonDirSafe` and
  `getCommonDir` helpers in `src/git/worktrees.ts` remain — the cache wraps
  them, doesn't replace them.
- Background refresh failure (e.g. the Repository's folder was deleted) keeps
  the last cached value. A separate ADR or follow-up will decide pruning
  policy if this becomes a real failure mode.

## Consequences

- First paint after activation renders worktrees synchronously, matching
  Explorer's behavior for the warm-cache case (which is every case after
  the first activation per Repository).
- Brief lies are possible in a ~200ms window between paint and refresh if
  worktrees changed outside VS Code since last session. The next paint
  corrects.
- More `globalState` surface to maintain. Cache invalidation bugs are a new
  failure mode — mitigated by the always-on background refresh that
  reconciles within one render cycle.
- Cache size: each Worktree entry is small; total per Repository ~bytes per
  worktree × N worktrees. Several hundred entries fit comfortably in
  globalState.

## Refines

- ADR-0003 indirectly. The reload cost ADR-0003 accepted is partially offset
  by faster post-reload render — the workbench reload still happens, but
  Deck's contribution to that reload's wall-clock drops to near-zero.

## Status

Accepted.
