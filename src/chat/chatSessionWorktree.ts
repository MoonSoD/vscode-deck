import * as path from 'node:path';

// A ChatSession's cwd may be a Worktree's own path or any directory nested under
// it (e.g. a monorepo package inside the Worktree). Assign it to the deepest
// Worktree that contains it, matching only on path boundaries so `/w/frontend`
// never captures a cwd under the sibling `/w/frontend-e2e`.
export function worktreeForCwd(cwd: string, worktreePaths: readonly string[]): string | undefined {
  const target = path.resolve(cwd);
  let best: string | undefined;
  let bestLength = -1;
  for (const worktreePath of worktreePaths) {
    const base = path.resolve(worktreePath);
    if (target !== base && !target.startsWith(base + path.sep)) continue;
    if (base.length > bestLength) {
      best = worktreePath;
      bestLength = base.length;
    }
  }
  return best;
}
