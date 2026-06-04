import * as path from 'node:path';

/**
 * Mirrors VS Code's git extension convention for new worktree placement:
 * `<parent>/<repo-name>.worktrees/<branch-with-slashes-as-dashes>`. Groups
 * all worktrees of one repo under a single sibling directory so the parent
 * (typically `~/code/`) doesn't accumulate one entry per branch.
 *
 * The slug is intentionally minimal — only `/` → `-`. Git already restricts
 * the characters that can appear in a ref name, so further stripping would
 * just produce surprising paths for unusual but valid branches.
 *
 * See `extensions/git/src/commands.ts` `getWorktreePath` in microsoft/vscode.
 */
export function defaultWorktreePath(mainWorktreePath: string, branch: string): string {
  const normalizedMain = path.normalize(mainWorktreePath);
  const worktreeName = branch.replace(/\//g, '-');
  return path.join(
    path.dirname(normalizedMain),
    `${path.basename(normalizedMain)}.worktrees`,
    worktreeName,
  );
}
