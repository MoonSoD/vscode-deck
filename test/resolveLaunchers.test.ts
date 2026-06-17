import { describe, expect, it, vi } from 'vitest';
import {
  resolveLaunchers,
  selectRunOnWorktreeCreateLaunchers,
} from '../src/launchers/resolveLaunchers';

describe('resolveLaunchers', () => {
  it('returns repository launchers before user launchers without overriding either group', async () => {
    const readRepoLaunchers = vi.fn(async () => [
      { label: 'Dev', command: 'npm run dev' },
    ]);
    const resolveCommonDir = vi.fn(async (path: string) =>
      path === '/work/repo' || path === '/work/repo-main' ? '/work/repo/.git' : null,
    );

    await expect(resolveLaunchers(
      '/work/repo',
      [
        { label: 'Dev', command: 'pnpm dev' },
        { command: 'npm test -- --watch' },
      ],
      [
        {
          repository: '/work/repo-main',
          launchers: [{ label: 'Local Bootstrap', command: 'pnpm bootstrap' }],
        },
      ],
      { readRepo: readRepoLaunchers, resolveCommonDir },
    )).resolves.toEqual({
      repo: [{ label: 'Dev', command: 'npm run dev' }],
      repositoryLocal: [{ label: 'Local Bootstrap', command: 'pnpm bootstrap' }],
      user: [
        { label: 'Dev', command: 'pnpm dev' },
        { label: 'npm test -- --watch', command: 'npm test -- --watch' },
      ],
    });
    expect(readRepoLaunchers).toHaveBeenCalledWith('/work/repo');
  });

  it('detects when both launcher groups are empty', async () => {
    await expect(resolveLaunchers('/work/repo', [], [], { readRepo: async () => [] })).resolves.toEqual({
      repo: [],
      repositoryLocal: [],
      user: [],
    });
  });

  it('selects run-on-worktree-create launchers in source order', () => {
    expect(selectRunOnWorktreeCreateLaunchers({
      repo: [
        { label: 'Repo Dev', command: 'npm run dev' },
        { label: 'Bootstrap', command: 'pnpm bootstrap', runOnWorktreeCreate: true },
      ],
      repositoryLocal: [
        { label: 'Local Claude', command: 'claude', runOnWorktreeCreate: true },
      ],
      user: [
        { label: 'Claude', command: 'claude', runOnWorktreeCreate: true },
        { label: 'Watch', command: 'npm test -- --watch' },
      ],
    })).toEqual([
      { label: 'Bootstrap', command: 'pnpm bootstrap', runOnWorktreeCreate: true },
      { label: 'Local Claude', command: 'claude', runOnWorktreeCreate: true },
      { label: 'Claude', command: 'claude', runOnWorktreeCreate: true },
    ]);
  });
});
