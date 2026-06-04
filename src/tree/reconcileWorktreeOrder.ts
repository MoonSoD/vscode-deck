import type { Worktree } from '../git/worktrees';

export function reconcileWorktreeOrder(
  storedOrder: readonly string[] | undefined,
  gitWorktrees: readonly Worktree[],
): readonly Worktree[] {
  if (storedOrder === undefined) return gitWorktrees;

  const byPath = new Map(gitWorktrees.map((worktree) => [worktree.path, worktree]));
  const emitted = new Set<string>();
  const ordered: Worktree[] = [];

  for (const path of storedOrder) {
    const worktree = byPath.get(path);
    if (!worktree) continue;
    ordered.push(worktree);
    emitted.add(path);
  }

  for (const worktree of gitWorktrees) {
    if (!emitted.has(worktree.path)) ordered.push(worktree);
  }

  return ordered;
}
