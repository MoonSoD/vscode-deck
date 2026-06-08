import { describe, expect, it } from 'vitest';
import { WORKTREE_ORDERS_KEY, WorktreeOrderStore } from '../src/worktree/worktreeOrderStore';

function createStore() {
  const values: Record<string, unknown> = {};
  const store = new WorktreeOrderStore({
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  });

  return { store, values };
}

describe('WorktreeOrderStore', () => {
  it('stores WorktreeOrder as a common-dir keyed map', async () => {
    const { store, values } = createStore();

    expect(store.get('/git/alpha')).toBeUndefined();

    await store.set('/git/alpha', ['/work/alpha-main', '/work/alpha-feature']);
    await store.set('/git/beta', ['/work/beta-main']);

    expect(values[WORKTREE_ORDERS_KEY]).toEqual({
      '/git/alpha': ['/work/alpha-main', '/work/alpha-feature'],
      '/git/beta': ['/work/beta-main'],
    });
    expect(store.get('/git/alpha')).toEqual(['/work/alpha-main', '/work/alpha-feature']);
  });

  it('overwrites and clears one Repository order without touching others', async () => {
    const { store, values } = createStore();

    await store.set('/git/alpha', ['/work/alpha-main']);
    await store.set('/git/beta', ['/work/beta-main']);
    await store.set('/git/alpha', ['/work/alpha-feature']);
    await store.clear('/git/alpha');

    expect(values[WORKTREE_ORDERS_KEY]).toEqual({
      '/git/beta': ['/work/beta-main'],
    });
    expect(store.get('/git/alpha')).toBeUndefined();
  });
});
