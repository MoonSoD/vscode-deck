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

    await expect(resolveLaunchers(
      '/work/repo',
      [
        { label: 'Dev', command: 'pnpm dev' },
        { command: 'npm test -- --watch' },
      ],
      readRepoLaunchers,
    )).resolves.toEqual({
      repo: [{ label: 'Dev', command: 'npm run dev' }],
      user: [
        { label: 'Dev', command: 'pnpm dev' },
        { label: 'npm test -- --watch', command: 'npm test -- --watch' },
      ],
    });
    expect(readRepoLaunchers).toHaveBeenCalledWith('/work/repo');
  });

  it('detects when both launcher groups are empty', async () => {
    await expect(resolveLaunchers('/work/repo', [], async () => [])).resolves.toEqual({
      repo: [],
      user: [],
    });
  });

  it('selects run-on-worktree-create launchers repo-first', () => {
    expect(selectRunOnWorktreeCreateLaunchers({
      repo: [
        { label: 'Repo Dev', command: 'npm run dev' },
        { label: 'Bootstrap', command: 'pnpm bootstrap', runOnWorktreeCreate: true },
      ],
      user: [
        { label: 'Claude', command: 'claude', runOnWorktreeCreate: true },
        { label: 'Watch', command: 'npm test -- --watch' },
      ],
    })).toEqual([
      { label: 'Bootstrap', command: 'pnpm bootstrap', runOnWorktreeCreate: true },
      { label: 'Claude', command: 'claude', runOnWorktreeCreate: true },
    ]);
  });
});
