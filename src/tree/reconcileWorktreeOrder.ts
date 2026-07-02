import type { Worktree } from '../git/worktrees';

export function reconcileWorktreeOrder(
  storedOrder: readonly string[] | undefined,
  gitWorktrees: readonly Worktree[],
): readonly Worktree[] {
  const byPath = new Map(gitWorktrees.map((worktree) => [worktree.path, worktree]));
  const emitted = new Set<string>();
  const ordered: Worktree[] = [];

  for (const path of storedOrder ?? []) {
    const worktree = byPath.get(path);
    if (!worktree) continue;
    ordered.push(worktree);
    emitted.add(path);
  }

  for (const worktree of sortUnplacedWorktrees(gitWorktrees, emitted)) {
    if (!emitted.has(worktree.path)) ordered.push(worktree);
  }

  return ordered;
}

function sortUnplacedWorktrees(
  gitWorktrees: readonly Worktree[],
  emitted: ReadonlySet<string>,
): Worktree[] {
  const mainWorktree = gitWorktrees.find((worktree) => !worktree.bare);
  const unplaced = gitWorktrees.filter(
    (worktree) => worktree.path !== mainWorktree?.path && !emitted.has(worktree.path),
  );

  unplaced.sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));

  if (mainWorktree === undefined || emitted.has(mainWorktree.path)) return unplaced;
  return [mainWorktree, ...unplaced];
}
