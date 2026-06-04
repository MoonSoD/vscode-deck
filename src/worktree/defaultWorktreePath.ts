import * as path from 'node:path';

export function defaultWorktreePath(mainWorktreePath: string, branch: string): string {
  const normalizedMain = path.normalize(mainWorktreePath);
  const slug = branch
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return path.join(
    path.dirname(normalizedMain),
    `${path.basename(normalizedMain)}-${slug || 'worktree'}`,
  );
}
