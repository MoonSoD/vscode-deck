import { execFile } from 'node:child_process';
import * as path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export interface Worktree {
  path: string;
  head: string;
  branch?: string;
  bare: boolean;
  detached: boolean;
}

export async function listWorktrees(projectPath: string): Promise<Worktree[]> {
  const { stdout } = await exec('git', ['worktree', 'list', '--porcelain'], {
    cwd: projectPath,
  });
  return parsePorcelain(stdout);
}

export async function getCommonDir(worktreePath: string): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', '--git-common-dir'], {
    cwd: worktreePath,
  });
  const commonDir = stdout.trim();
  return path.normalize(path.isAbsolute(commonDir) ? commonDir : path.resolve(worktreePath, commonDir));
}

export function parsePorcelain(input: string): Worktree[] {
  const out: Worktree[] = [];
  let current: Partial<Worktree> | null = null;
  for (const raw of input.split('\n')) {
    const line = raw.trimEnd();
    if (line === '') {
      if (current?.path) {
        out.push({
          path: current.path,
          head: current.head ?? '',
          branch: current.branch,
          bare: current.bare ?? false,
          detached: current.detached ?? false,
        });
      }
      current = null;
      continue;
    }
    current ??= {};
    if (line.startsWith('worktree ')) current.path = line.slice('worktree '.length);
    else if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length);
    else if (line.startsWith('branch ')) current.branch = line.slice('branch refs/heads/'.length);
    else if (line === 'bare') current.bare = true;
    else if (line === 'detached') current.detached = true;
  }
  if (current?.path) {
    out.push({
      path: current.path,
      head: current.head ?? '',
      branch: current.branch,
      bare: current.bare ?? false,
      detached: current.detached ?? false,
    });
  }
  return out;
}
