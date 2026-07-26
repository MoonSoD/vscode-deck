import { describe, expect, it, vi } from 'vitest';
import { ChatSessionStore } from '../src/chat/chatSessionStore';
import type { ChatSession } from '../src/chat/scanChatSessions';

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return { sessionId: 's1', cwd: '/work/a', lastModified: 1, ...overrides };
}

describe('ChatSessionStore', () => {
  it('exposes the scanned sessions after start', async () => {
    const sessions = [session({ sessionId: 's1' }), session({ sessionId: 's2' })];
    const store = new ChatSessionStore({
      scan: async () => sessions,
      watch: () => ({ dispose: () => undefined }),
    });

    await store.start();

    expect(store.all()).toEqual(sessions);
  });

  it('re-scans and notifies when the watch reports a change', async () => {
    let current = [session({ sessionId: 's1' })];
    let trigger = () => undefined as void;
    const store = new ChatSessionStore({
      scan: async () => current,
      watch: (onChange) => {
        trigger = onChange;
        return { dispose: () => undefined };
      },
      debounceMs: 0,
    });
    const listener = vi.fn();
    store.onDidChange(listener);

    await store.start();
    current = [session({ sessionId: 's1' }), session({ sessionId: 's2' })];
    trigger();
    await vi.waitFor(() => expect(store.all()).toHaveLength(2));

    expect(listener).toHaveBeenCalled();
  });

  it('does not notify when a rescan finds the same sessions', async () => {
    // The projects dir is watched recursively, so a write anywhere under it
    // (e.g. an unrelated CLI session's own transcript, filtered out of the
    // scan result) triggers a rescan. That must not fire onDidChange unless
    // the actually-relevant session list changed, or every worktree row
    // recomputes on every unrelated Claude Code write.
    const sessions = [session({ sessionId: 's1' })];
    let trigger = () => undefined as void;
    const scan = vi.fn(async () => sessions);
    const store = new ChatSessionStore({
      scan,
      watch: (onChange) => {
        trigger = onChange;
        return { dispose: () => undefined };
      },
      debounceMs: 0,
    });
    const listener = vi.fn();
    store.onDidChange(listener);

    await store.start();
    trigger();
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(2));

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops watching when disposed', async () => {
    const dispose = vi.fn();
    const store = new ChatSessionStore({
      scan: async () => [],
      watch: () => ({ dispose }),
    });

    const handle = await store.start();
    handle.dispose();

    expect(dispose).toHaveBeenCalled();
  });
});
