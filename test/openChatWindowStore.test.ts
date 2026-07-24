import { describe, expect, it, vi } from 'vitest';
import {
  OpenChatWindowStore,
  unionOpenChatTitles,
  type OpenChatWindowEntry,
} from '../src/chat/openChatWindowStore';

describe('unionOpenChatTitles', () => {
  it('unions the titles reported by every window', () => {
    const entries: OpenChatWindowEntry[] = [
      { titles: ['Fix the bug', 'Refactor'], updatedAt: 100 },
      { titles: ['Refactor', 'Write docs'], updatedAt: 100 },
    ];

    expect(unionOpenChatTitles(entries, 100, 1000)).toEqual(
      new Set(['Fix the bug', 'Refactor', 'Write docs']),
    );
  });

  it('drops entries whose report has gone stale past the TTL', () => {
    const entries: OpenChatWindowEntry[] = [
      { titles: ['Fresh'], updatedAt: 900 },
      { titles: ['Crashed window'], updatedAt: 100 },
    ];

    // now=1000, ttl=500 → the 100 entry is 900ms old and excluded.
    expect(unionOpenChatTitles(entries, 1000, 500)).toEqual(new Set(['Fresh']));
  });
});

describe('OpenChatWindowStore', () => {
  function deps(overrides: { entries?: OpenChatWindowEntry[]; now?: number; ttlMs?: number } = {}) {
    const state = {
      entries: overrides.entries ?? [],
      now: overrides.now ?? 1000,
      own: undefined as OpenChatWindowEntry | undefined,
    };
    const write = vi.fn(async (entry: OpenChatWindowEntry) => {
      state.entries = [...state.entries.filter((existing) => existing !== state.own), entry];
      state.own = entry;
    });
    const remove = vi.fn(async () => {
      state.entries = state.entries.filter((entry) => entry !== state.own);
      state.own = undefined;
    });
    let trigger = () => undefined as void;
    const store = new OpenChatWindowStore({
      now: () => state.now,
      ttlMs: overrides.ttlMs ?? 1000,
      debounceMs: 0,
      readAll: async () => state.entries,
      write,
      remove,
      watch: (onChange) => {
        trigger = onChange;
        return { dispose: () => undefined };
      },
    });
    return { store, state, write, remove, fire: () => trigger() };
  }

  it('exposes the union across windows after start', async () => {
    const { store } = deps({
      entries: [
        { titles: ['A'], updatedAt: 1000 },
        { titles: ['B'], updatedAt: 1000 },
      ],
    });

    await store.start();

    expect(store.union()).toEqual(new Set(['A', 'B']));
  });

  it('publishes this window entry and folds it into the union', async () => {
    const { store, write } = deps({ entries: [{ titles: ['Other'], updatedAt: 1000 }] });
    await store.start();

    await store.publish(['Mine']);

    expect(write).toHaveBeenCalledWith({ titles: ['Mine'], updatedAt: 1000 });
    expect(store.union()).toEqual(new Set(['Other', 'Mine']));
  });

  it('notifies listeners only when the watched union actually changes', async () => {
    const { store, state, fire } = deps({ entries: [{ titles: ['A'], updatedAt: 1000 }] });
    const listener = vi.fn();
    store.onDidChange(listener);
    await store.start();

    fire();
    await vi.waitFor(() => expect(listener).not.toHaveBeenCalled());

    state.entries = [{ titles: ['A', 'B'], updatedAt: 1000 }];
    fire();
    await vi.waitFor(() => expect(store.union()).toEqual(new Set(['A', 'B'])));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('heartbeat re-publishes the last titles with a fresh timestamp', async () => {
    const { store, state, write } = deps({ entries: [] });
    await store.start();
    await store.publish(['Mine']);
    state.now = 5000;

    await store.heartbeat();

    expect(write).toHaveBeenLastCalledWith({ titles: ['Mine'], updatedAt: 5000 });
  });

  it('removes this window entry on dispose so its titles stop counting', async () => {
    const { store, remove } = deps({ entries: [] });
    const handle = await store.start();

    handle.dispose();

    expect(remove).toHaveBeenCalled();
  });
});
