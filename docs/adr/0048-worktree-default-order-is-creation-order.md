# ADR-0048: Uncurated worktree order is creation order, from the reflog

## Context

`WorktreeOrder` was documented as "the user-curated display order," but until
the user drag-reordered a Repository there was **no defined order**:
`reconcileWorktreeOrder` returned `git worktree list --porcelain` verbatim, which
lists linked worktrees in `.git/worktrees/` readdir order — **alphabetical by
path** on APFS. So a freshly added worktree surfaced wherever its name sorted
(`ins-3731` landed 4th of 6), not last.

This silently contradicted ADR-0028, which built `TerminalOrder` to make "a
freshly created Terminal land at the bottom" and claimed it *mirrored*
Worktrees. It didn't: a Terminal's fallback (`term-N`) is allocation order, so
appending newest-last works; a Worktree's fallback (git/alphabetical) is not
creation order, so the mirror was broken on the Worktree side.

`AddWorktreeCommand` never wrote `WorktreeOrder` (only drag and RepositoryRemoval
do), so the gap hit every user who hadn't manually reordered — and it could not
be fixed by an append-on-create hook, because the worktrees already sitting
mis-ordered in the tree predate any such hook.

## Decision

The uncurated default is **creation order, newest last**, with the main
Worktree pinned first. Drag-curated order still wins (reconcile phase 1
unchanged); creation order replaces git/alphabetical only for worktrees the user
hasn't placed (phase 2).

1. **Signal = reflog creation timestamp**, not filesystem `birthtime`. The first
   entry of `<commonDir>/worktrees/<id>/logs/HEAD` records when `git worktree
   add` created the worktree, stored *in file content* — so it is OS- and
   filesystem-independent. `birthtime` was rejected: on Linux it depends on
   kernel ≥ 4.11, the filesystem recording btime, and `statx` not being
   seccomp-blocked (containers), and silently falls back to `ctime`/epoch-0 when
   unavailable — a wrong order with no error. The reflog agrees exactly with
   birthtime where both exist (verified) and degrades only for a worktree older
   than `gc.reflogExpire` (90d) whose creation entry has rolled off.

2. **Stable sort, no explicit fallback.** `reconcileWorktreeOrder` phase 2
   stable-sorts by `createdAt`. `Array.prototype.sort` is stable (ES2019), so
   worktrees that tie — same-second creation, or a repo with
   `core.logAllRefUpdates` off where *all* worktrees are undated — retain git's
   relative order for free. The mixed case (some dated, some not in one repo)
   requires toggling `core.logAllRefUpdates` between two adds and is not
   designed for.

3. **`createdAt` is cached on `Worktree`.** Read in the async list/refresh path
   (a small file read per worktree, no process spawn), stored in the
   WorktreeListCache. Render stays synchronous per ADR-0007; the schema bump
   makes existing cache entries cold once, re-reading the reflog.

4. **Main worktree pinned first.** It has no `.git/worktrees/<id>` admin dir and
   is the anchor users return to, so it is placed first explicitly rather than
   sorted by timestamp.

## Consequences

- The order fix is retroactive: existing worktrees re-sort by creation on the
  next cold-cache read, not just future adds.
- Default order changes for every user who never dragged — from alphabetical to
  creation order. Intended; alphabetical was accidental, undefended by any ADR.
- One more cached field and a schema bump; no new write path, no seeding, no
  hooking of create/remove.

## Refines

- **ADR-0028.** Makes the Terminal/Worktree "append-at-bottom" mirror it claimed
  actually hold, by giving Worktrees a creation-order default instead of an
  alphabetical one.
- **ADR-0007.** Adds `createdAt` to the cached `Worktree` shape under the
  existing `schemaVersion` mechanism.

## Status

Accepted.
</content>
</invoke>
