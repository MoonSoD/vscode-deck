import type { Worktree } from '../git/worktrees';

export function excludeBare(worktrees: readonly Worktree[]): Worktree[] {
  return worktrees.filter((worktree) => !worktree.bare);
}
