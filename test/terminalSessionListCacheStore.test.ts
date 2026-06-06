import { describe, expect, it } from 'vitest';
import {
  TERMINAL_SESSION_LIST_CACHE_KEY,
  TERMINAL_SESSION_LIST_CACHE_SCHEMA_VERSION,
  TerminalSessionListCacheStore,
} from '../src/terminal/terminalSessionListCacheStore';

function createStore() {
  const values: Record<string, unknown> = {};
  const store = new TerminalSessionListCacheStore({
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  });

  return { store, values };
}

const alphaTerminals = [
  {
    sessionName: 'wt-_work_alpha-main__term-1',
    n: 1,
    windowName: 'zsh',
  },
];

describe('TerminalSessionListCacheStore', () => {
  it('returns undefined for an empty cache', () => {
    const { store } = createStore();

    expect(store.get('wt-_work_alpha-main__')).toBeUndefined();
  });

  it('round-trips terminal rows for one prefix', async () => {
    const { store } = createStore();

    await store.set('wt-_work_alpha-main__', alphaTerminals);

    expect(store.get('wt-_work_alpha-main__')).toEqual(alphaTerminals);
  });

  it('treats schema-version mismatch as cold cache', () => {
    const { store, values } = createStore();
    values[TERMINAL_SESSION_LIST_CACHE_KEY] = {
      'wt-_work_alpha-main__': {
        schemaVersion: TERMINAL_SESSION_LIST_CACHE_SCHEMA_VERSION - 1,
        terminals: alphaTerminals,
      },
    };

    expect(store.get('wt-_work_alpha-main__')).toBeUndefined();
  });

  it('isolates multiple prefixes', async () => {
    const { store } = createStore();
    const betaTerminals = [
      {
        sessionName: 'wt-_work_beta-main__term-1',
        n: 1,
        windowName: 'claude',
      },
    ];

    await store.set('wt-_work_alpha-main__', alphaTerminals);
    await store.set('wt-_work_beta-main__', betaTerminals);

    expect(store.get('wt-_work_alpha-main__')).toEqual(alphaTerminals);
    expect(store.get('wt-_work_beta-main__')).toEqual(betaTerminals);
  });

  it('removes one terminal session without touching others', async () => {
    const { store } = createStore();
    await store.set('wt-_work_alpha-main__', [
      ...alphaTerminals,
      {
        sessionName: 'wt-_work_alpha-main__term-2',
        n: 2,
        windowName: 'claude',
      },
    ]);
    await store.set('wt-_work_beta-main__', [
      {
        sessionName: 'wt-_work_beta-main__term-1',
        n: 1,
        windowName: 'zsh',
      },
    ]);

    await store.removeSession('wt-_work_alpha-main__term-1');

    expect(store.get('wt-_work_alpha-main__')).toEqual([
      {
        sessionName: 'wt-_work_alpha-main__term-2',
        n: 2,
        windowName: 'claude',
      },
    ]);
    expect(store.get('wt-_work_beta-main__')).toEqual([
      {
        sessionName: 'wt-_work_beta-main__term-1',
        n: 1,
        windowName: 'zsh',
      },
    ]);
  });
});
