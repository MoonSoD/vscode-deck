import { describe, expect, it, vi } from 'vitest';
import {
  PENDING_TERMINAL_OPEN_KEY,
  PENDING_TERMINAL_OPEN_SCHEMA_VERSION,
  PendingTerminalOpenStore,
} from '../src/terminal/pendingTerminalOpenStore';

function createStore(now = vi.fn(() => 1_000)) {
  const values: Record<string, unknown> = {};
  const update = vi.fn(async (key: string, value: unknown) => {
    values[key] = value;
  });
  const store = new PendingTerminalOpenStore(
    {
      get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
      update,
    },
    now,
  );

  return { store, values, now, update };
}

describe('PendingTerminalOpenStore', () => {
  it('consumes the session for a worktree once', async () => {
    const { store, values } = createStore();

    await store.set('/work/alpha-main', 'wt-_work_alpha-main__term-1');

    expect(await store.consume('/work/alpha-main')).toBe('wt-_work_alpha-main__term-1');
    expect(await store.consume('/work/alpha-main')).toBeUndefined();
    expect(values[PENDING_TERMINAL_OPEN_KEY]).toEqual({
      schemaVersion: 1,
      entries: {},
    });
  });

  it('returns undefined and prunes when the intent is older than the ttl', async () => {
    const now = vi.fn(() => 1_000);
    const { store, values } = createStore(now);
    await store.set('/work/alpha-main', 'wt-_work_alpha-main__term-1');
    now.mockReturnValue(61_001);

    expect(await store.consume('/work/alpha-main')).toBeUndefined();
    expect(values[PENDING_TERMINAL_OPEN_KEY]).toEqual({
      schemaVersion: 1,
      entries: {},
    });
  });

  it('resets mismatched schema versions on consume', async () => {
    const { store, values } = createStore();
    values[PENDING_TERMINAL_OPEN_KEY] = {
      schemaVersion: PENDING_TERMINAL_OPEN_SCHEMA_VERSION - 1,
      entries: {
        '/work/alpha-main': {
          sessionName: 'wt-_work_alpha-main__term-1',
          createdAt: 1_000,
        },
      },
    };

    expect(await store.consume('/work/alpha-main')).toBeUndefined();
    expect(values[PENDING_TERMINAL_OPEN_KEY]).toEqual({
      schemaVersion: PENDING_TERMINAL_OPEN_SCHEMA_VERSION,
      entries: {},
    });
  });

  it('returns undefined for unknown worktrees without touching other intents', async () => {
    const { store } = createStore();
    await store.set('/work/alpha-main', 'wt-_work_alpha-main__term-1');

    expect(await store.consume('/work/beta-main')).toBeUndefined();
    expect(await store.consume('/work/alpha-main')).toBe('wt-_work_alpha-main__term-1');
  });

  it('peek returns the intent without deleting it', async () => {
    const { store } = createStore();
    await store.set('/work/alpha-main', 'wt-_work_alpha-main__term-1');

    expect(await store.peek('/work/alpha-main')).toBe('wt-_work_alpha-main__term-1');
    expect(await store.peek('/work/alpha-main')).toBe('wt-_work_alpha-main__term-1');
    expect(await store.consume('/work/alpha-main')).toBe('wt-_work_alpha-main__term-1');
  });

  it('peek prunes expired entries', async () => {
    const now = vi.fn(() => 1_000);
    const { store, values } = createStore(now);
    await store.set('/work/alpha-main', 'wt-_work_alpha-main__term-1');
    now.mockReturnValue(61_001);

    expect(await store.peek('/work/alpha-main')).toBeUndefined();
    expect(values[PENDING_TERMINAL_OPEN_KEY]).toEqual({
      schemaVersion: 1,
      entries: {},
    });
  });

  it('normalizes worktree paths across trailing slashes', async () => {
    const { store } = createStore();
    await store.set('/work/alpha-main/', 'wt-_work_alpha-main__term-1');

    expect(await store.peek('/work/alpha-main')).toBe('wt-_work_alpha-main__term-1');
    expect(await store.consume('/work/alpha-main')).toBe('wt-_work_alpha-main__term-1');
  });

  it('does not write back when consume misses with nothing to prune', async () => {
    const { store, update } = createStore();

    expect(await store.consume('/work/beta-main')).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
  });
});
