import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PendingChatOpenStore } from '../src/chat/pendingChatOpenStore';

const roots: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deck-pending-chat-'));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('PendingChatOpenStore', () => {
  it('returns a queued session id for its worktree, once', async () => {
    const store = new PendingChatOpenStore(join(tempDir(), 'pending'));
    await store.set('/work/beta', 'sess-1');

    expect(await store.consume('/work/beta')).toBe('sess-1');
    expect(await store.consume('/work/beta')).toBeUndefined();
  });

  it('does not return a session queued for a different worktree', async () => {
    const store = new PendingChatOpenStore(join(tempDir(), 'pending'));
    await store.set('/work/beta', 'sess-1');

    expect(await store.consume('/work/alpha')).toBeUndefined();
  });

  it('ignores an expired queued session', async () => {
    let now = 1_000;
    const store = new PendingChatOpenStore(join(tempDir(), 'pending'), () => now, 60_000);
    await store.set('/work/beta', 'sess-1');
    now += 61_000;

    expect(await store.consume('/work/beta')).toBeUndefined();
  });

  it('notifies watchers when an entry is written by another writer', async () => {
    const dir = join(tempDir(), 'pending');
    const reader = new PendingChatOpenStore(dir, Date.now, 60_000, 10);
    const writer = new PendingChatOpenStore(dir);
    const handle = await reader.start();
    const listener = vi.fn();
    reader.onDidChange(listener);

    await writer.set('/work/beta', 'sess-1');
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());

    handle.dispose();
    expect(await reader.consume('/work/beta')).toBe('sess-1');
  });
});
