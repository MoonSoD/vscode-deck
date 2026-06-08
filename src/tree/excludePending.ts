import type { Worktree } from '../git/worktrees';

export function excludePending(
  worktrees: readonly Worktree[],
  pending: ReadonlySet<string>,
): Worktree[] {
  return worktrees.filter((worktree) => !pending.has(worktree.path));
}
