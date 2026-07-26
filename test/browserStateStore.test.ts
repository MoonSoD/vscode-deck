import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { BrowserStateStore } from '../src/browser/browserStateStore';

const roots: string[] = [];
function tempFile(): string {
  const dir = mkdtempSync(join(tmpdir(), 'deck-browser-state-'));
  roots.push(dir);
  return join(dir, 'state.json');
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('BrowserStateStore', () => {
  it('returns an empty state for an unknown worktree', async () => {
    const store = new BrowserStateStore(tempFile());
    expect(await store.get('/work/foo')).toEqual({});
  });

  it('persists a patched state and reads it back', async () => {
    const store = new BrowserStateStore(tempFile());
    await store.patch('/work/foo', { debugPort: 9315, profileSeeded: true });
    expect(await store.get('/work/foo')).toEqual({ debugPort: 9315, profileSeeded: true });
  });

  it('merges successive patches instead of replacing', async () => {
    const store = new BrowserStateStore(tempFile());
    await store.patch('/work/foo', { debugPort: 9315 });
    await store.patch('/work/foo', { pid: 4242 });
    expect(await store.get('/work/foo')).toEqual({ debugPort: 9315, pid: 4242 });
  });

  it('keeps worktrees independent and is visible to a second reader of the same file', async () => {
    const file = tempFile();
    const writer = new BrowserStateStore(file);
    await writer.patch('/work/a', { debugPort: 1 });
    await writer.patch('/work/b', { debugPort: 2 });

    const reader = new BrowserStateStore(file);
    expect(await reader.get('/work/a')).toEqual({ debugPort: 1 });
    expect(await reader.get('/work/b')).toEqual({ debugPort: 2 });
  });

  it('deletes a worktree entry', async () => {
    const store = new BrowserStateStore(tempFile());
    await store.patch('/work/foo', { debugPort: 9315 });
    await store.delete('/work/foo');
    expect(await store.get('/work/foo')).toEqual({});
  });
});
