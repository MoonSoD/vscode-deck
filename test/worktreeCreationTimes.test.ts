import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { worktreeCreationTimes } from '../src/git/worktreeCreationTimes';

const exec = promisify(execFile);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })));
  roots.length = 0;
});

describe('worktreeCreationTimes', () => {
  it('reads linked worktree creation timestamps from reflog admin dirs', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'deck-worktree-times-')));
    roots.push(root);
    const repositoryPath = join(root, 'repo');
    await mkdir(repositoryPath);
    await git(repositoryPath, 'init');
    await git(repositoryPath, 'config', 'user.email', 'deck@example.com');
    await git(repositoryPath, 'config', 'user.name', 'Deck Test');
    await writeFile(join(repositoryPath, 'README.md'), 'hello\n');
    await git(repositoryPath, 'add', 'README.md');
    await git(repositoryPath, 'commit', '-m', 'initial');

    const firstPath = join(root, 'one', 'same');
    const secondPath = join(root, 'two', 'same');
    await mkdir(join(root, 'one'));
    await mkdir(join(root, 'two'));
    await git(repositoryPath, 'worktree', 'add', '-b', 'first', firstPath);
    await git(repositoryPath, 'worktree', 'add', '-b', 'second', secondPath);

    const { stdout } = await git(repositoryPath, 'rev-parse', '--git-common-dir');
    const commonDir = join(repositoryPath, stdout.trim());

    const times = await worktreeCreationTimes(commonDir);

    expect([...times.keys()].sort()).toEqual([firstPath, secondPath].sort());
    expect(times.get(firstPath)).toEqual(expect.any(Number));
    expect(times.get(secondPath)).toEqual(expect.any(Number));
    expect(times.has(repositoryPath)).toBe(false);
  });
});

async function git(cwd: string, ...args: string[]) {
  return exec('git', args, { cwd });
}
