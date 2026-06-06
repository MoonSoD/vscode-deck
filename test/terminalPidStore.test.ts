import { describe, expect, it, vi } from 'vitest';
import {
  TERMINAL_PID_KEY,
  TERMINAL_PID_SCHEMA_VERSION,
  TerminalPidStore,
} from '../src/terminal/terminalPidStore';

function createStore() {
  const values: Record<string, unknown> = {};
  const update = vi.fn(async (key: string, value: unknown) => {
    values[key] = value;
  });
  const store = new TerminalPidStore({
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update,
  });

  return { store, values, update };
}

describe('TerminalPidStore', () => {
  it('round-trips and removes terminal pids by session', async () => {
    const { store } = createStore();

    await store.set('wt-_work_repo__term-1', 1234);

    expect(store.get('wt-_work_repo__term-1')).toBe(1234);
    expect(store.get('unknown')).toBeUndefined();

    await store.remove('wt-_work_repo__term-1');

    expect(store.get('wt-_work_repo__term-1')).toBeUndefined();
  });

  it('resets mismatched schema versions', () => {
    const { store, values } = createStore();
    values[TERMINAL_PID_KEY] = {
      schemaVersion: TERMINAL_PID_SCHEMA_VERSION - 1,
      bySession: {
        'wt-_work_repo__term-1': 1234,
      },
    };

    expect(store.get('wt-_work_repo__term-1')).toBeUndefined();
  });

  it('prunes pids for missing tmux sessions', async () => {
    const { store, values } = createStore();
    await store.set('wt-_work_repo__term-1', 1111);
    await store.set('wt-_work_repo__term-2', 2222);

    await store.prune(['wt-_work_repo__term-2']);

    expect(values[TERMINAL_PID_KEY]).toEqual({
      schemaVersion: TERMINAL_PID_SCHEMA_VERSION,
      bySession: {
        'wt-_work_repo__term-2': 2222,
      },
    });
  });
});
