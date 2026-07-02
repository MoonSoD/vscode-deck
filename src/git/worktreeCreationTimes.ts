import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';

export async function worktreeCreationTimes(commonDir: string): Promise<Map<string, number>> {
  const times = new Map<string, number>();

  for (const adminDir of await linkedWorktreeAdminDirs(commonDir)) {
    const worktreePath = await readWorktreePath(adminDir);
    const createdAt = await readCreationTime(adminDir);
    if (worktreePath !== undefined && createdAt !== undefined) {
      times.set(worktreePath, createdAt);
    }
  }

  return times;
}

async function linkedWorktreeAdminDirs(commonDir: string): Promise<string[]> {
  try {
    const entries = await readdir(path.join(commonDir, 'worktrees'), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(commonDir, 'worktrees', entry.name));
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
}

async function readWorktreePath(adminDir: string): Promise<string | undefined> {
  try {
    const gitdir = (await readFile(path.join(adminDir, 'gitdir'), 'utf8')).trim();
    const gitdirPath = path.isAbsolute(gitdir) ? gitdir : path.resolve(adminDir, gitdir);
    return path.normalize(path.dirname(gitdirPath));
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

async function readCreationTime(adminDir: string): Promise<number | undefined> {
  try {
    const firstLine = (await readFile(path.join(adminDir, 'logs', 'HEAD'), 'utf8')).split('\n')[0];
    return parseReflogEpoch(firstLine);
  } catch (error) {
    if (isNotFound(error)) return undefined;
    throw error;
  }
}

function parseReflogEpoch(line: string): number | undefined {
  const header = line.split('\t')[0];
  const match = header.match(/ (\d+) [+-]\d{4}$/);
  return match === null ? undefined : Number(match[1]);
}

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
