import { describe, expect, it } from 'vitest';
import { WORKTREE_ROOTS_KEY, WorktreeRootStore } from '../src/worktree/worktreeRootStore';

describe('WorktreeRootStore', () => {
  it('stores remembered roots as a common-dir keyed map', async () => {
    const values: Record<string, unknown> = {};
    const store = new WorktreeRootStore({
      get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
      update: async (key: string, value: unknown) => {
        values[key] = value;
      },
    });

    await store.set('/git/alpha', '/worktrees/alpha');
    await store.set('/git/beta', '/worktrees/beta');

    expect(values[WORKTREE_ROOTS_KEY]).toEqual({
      '/git/alpha': '/worktrees/alpha',
      '/git/beta': '/worktrees/beta',
    });
    expect(store.get('/git/alpha')).toBe('/worktrees/alpha');
  });

  it('clears one remembered root without touching other repositories', async () => {
    const values: Record<string, unknown> = {
      [WORKTREE_ROOTS_KEY]: {
        '/git/alpha': '/worktrees/alpha',
        '/git/beta': '/worktrees/beta',
      },
    };
    const store = new WorktreeRootStore({
      get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
      update: async (key: string, value: unknown) => {
        values[key] = value;
      },
    });

    await store.clear('/git/alpha');

    expect(values[WORKTREE_ROOTS_KEY]).toEqual({
      '/git/beta': '/worktrees/beta',
    });
  });
});
