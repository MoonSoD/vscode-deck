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

export type AddWorktreeOptions =
  | {
      path: string;
      branch: string;
    }
  | {
      path: string;
      newBranch: string;
      baseRef: string;
    };

export async function listWorktrees(projectPath: string): Promise<Worktree[]> {
  const { stdout } = await exec('git', ['worktree', 'list', '--porcelain'], {
    cwd: projectPath,
  });
  return parsePorcelain(stdout);
}

export async function listBranches(projectPath: string): Promise<string[]> {
  const { stdout } = await exec(
    'git',
    ['for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'],
    { cwd: projectPath },
  );
  return parseBranchRefs(stdout);
}

export async function addWorktree(
  projectPath: string,
  options: AddWorktreeOptions,
): Promise<void> {
  const args =
    'newBranch' in options
      ? ['worktree', 'add', '-b', options.newBranch, options.path, options.baseRef]
      : ['worktree', 'add', options.path, options.branch];
  await exec('git', args, { cwd: projectPath });
}

export async function getCommonDir(worktreePath: string): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', '--git-common-dir'], {
    cwd: worktreePath,
  });
  const commonDir = stdout.trim();
  const absoluteCommonDir = path.isAbsolute(commonDir) ? commonDir : path.resolve(worktreePath, commonDir);
  return path.normalize(absoluteCommonDir);
}

/**
 * Like {@link getCommonDir} but returns null instead of throwing when the path
 * is not a git worktree (or no longer exists). Lets non-git workspace folders
 * coexist with Deck-managed roots without breaking switching or activation.
 */
export async function getCommonDirSafe(worktreePath: string): Promise<string | null> {
  try {
    return await getCommonDir(worktreePath);
  } catch {
    return null;
  }
}

export function parsePorcelain(input: string): Worktree[] {
  const out: Worktree[] = [];
  let current: Partial<Worktree> | null = null;

  const pushCurrent = () => {
    if (!current?.path) return;

    out.push({
      path: current.path,
      head: current.head ?? '',
      branch: current.branch,
      bare: current.bare ?? false,
      detached: current.detached ?? false,
    });
  };

  for (const raw of input.split('\n')) {
    const line = raw.trimEnd();
    if (line === '') {
      pushCurrent();
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
  pushCurrent();
  return out;
}

export function parseBranchRefs(input: string): string[] {
  const seen = new Set<string>();
  const branches: string[] = [];

  for (const raw of input.split('\n')) {
    const branch = raw.trim();
    if (branch === '' || branch.endsWith('/HEAD') || seen.has(branch)) continue;
    seen.add(branch);
    branches.push(branch);
  }

  return branches;
}
