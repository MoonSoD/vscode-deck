import { describe, expect, it } from 'vitest';
import {
  ActiveWorktreeStore,
  ACTIVE_WORKTREES_KEY,
  FOCUS_DECK_AFTER_RELOAD_KEY,
} from '../src/switch/activeWorktreeStore';

describe('ActiveWorktreeStore', () => {
  it('stores active worktrees as a common-dir keyed map', async () => {
    const values: Record<string, unknown> = {};
    const store = new ActiveWorktreeStore({
      get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
      update: async (key: string, value: unknown) => {
        values[key] = value;
      },
    });

    await store.set('/git/alpha', '/work/alpha-feature');
    await store.set('/git/beta', '/work/beta-main');

    expect(values[ACTIVE_WORKTREES_KEY]).toEqual({
      '/git/alpha': '/work/alpha-feature',
      '/git/beta': '/work/beta-main',
    });
    expect(store.get('/git/alpha')).toBe('/work/alpha-feature');
  });

  it('consumes the Deck focus intent exactly once', async () => {
    const values: Record<string, unknown> = {};
    const store = new ActiveWorktreeStore({
      get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
      update: async (key: string, value: unknown) => {
        values[key] = value;
      },
    });

    await store.setFocusIntent(true);

    expect(values[FOCUS_DECK_AFTER_RELOAD_KEY]).toBe(true);
    expect(await store.consumeFocusIntent()).toBe(true);
    expect(values[FOCUS_DECK_AFTER_RELOAD_KEY]).toBe(false);
    expect(await store.consumeFocusIntent()).toBe(false);
  });
});
