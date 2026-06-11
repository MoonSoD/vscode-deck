import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentStatusStore } from '../src/agent/agentStatusStore';

const tempRoots: string[] = [];
const disposables: Array<{ dispose(): void }> = [];
// fs.watch event delivery can exceed vi.waitFor's 1s default when the full
// suite runs in parallel; these tests pass in isolation but flake under load.
const WATCH_EVENT_WAIT = { timeout: 5000 };

describe('AgentStatusStore', () => {
  afterEach(() => {
    for (const disposable of disposables.splice(0)) {
      disposable.dispose();
    }
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('updates completed status by Terminal session name when a status file appears and changes', async () => {
    const root = tempRoot();
    const store = new AgentStatusStore(root, 10);
    const changes = vi.fn();
    disposables.push(store.onDidChange(changes));
    disposables.push(await store.start());

    writeFileSync(
      join(root, 'wt-_work_repo__term-1.json'),
      '{"status":"completed","statusAt":1710000000}\n',
      'utf8',
    );

    await vi.waitFor(() => {
      expect(store.get('wt-_work_repo__term-1')).toEqual({
        status: 'completed',
        statusAt: 1710000000,
        unread: true,
      });
    }, WATCH_EVENT_WAIT);

    writeFileSync(
      join(root, 'wt-_work_repo__term-1.json'),
      '{"status":"completed","statusAt":1710000001}\n',
      'utf8',
    );

    await vi.waitFor(() => {
      expect(store.get('wt-_work_repo__term-1')).toEqual({
        status: 'completed',
        statusAt: 1710000001,
        unread: true,
      });
    }, WATCH_EVENT_WAIT);
    expect(changes).toHaveBeenCalled();
  });

  it('marks a completed Terminal read and re-arms unread for a newer completion', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'wt-_work_repo__term-1.json'),
      '{"status":"completed","statusAt":1710000000}\n',
      'utf8',
    );
    const store = new AgentStatusStore(root, 10);
    disposables.push(await store.start());

    expect(store.get('wt-_work_repo__term-1')).toEqual({
      status: 'completed',
      statusAt: 1710000000,
      unread: true,
    });

    await store.markRead('wt-_work_repo__term-1');

    expect(store.get('wt-_work_repo__term-1')).toEqual({
      status: 'completed',
      statusAt: 1710000000,
      unread: false,
    });

    writeFileSync(
      join(root, 'wt-_work_repo__term-1.json'),
      '{"status":"completed","statusAt":1710000001}\n',
      'utf8',
    );

    await vi.waitFor(() => {
      expect(store.get('wt-_work_repo__term-1')).toEqual({
        status: 'completed',
        statusAt: 1710000001,
        unread: true,
      });
    }, WATCH_EVENT_WAIT);
  });

  it('reflects read state in entries() so the status decoration clears on read', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'wt-_work_repo__term-1.json'),
      '{"status":"completed","statusAt":1710000000}\n',
      'utf8',
    );
    const store = new AgentStatusStore(root, 10);
    disposables.push(await store.start());

    expect(new Map(store.entries()).get('wt-_work_repo__term-1')).toEqual({
      status: 'completed',
      statusAt: 1710000000,
      unread: true,
    });

    await store.markRead('wt-_work_repo__term-1');

    expect(new Map(store.entries()).get('wt-_work_repo__term-1')).toEqual({
      status: 'completed',
      statusAt: 1710000000,
      unread: false,
    });
  });

  it('shares read markers across stores watching the same machine status area', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'wt-_work_repo__term-1.json'),
      '{"status":"completed","statusAt":1710000000}\n',
      'utf8',
    );
    const windowA = new AgentStatusStore(root, 10);
    const windowB = new AgentStatusStore(root, 10);
    disposables.push(await windowA.start());
    disposables.push(await windowB.start());

    await windowA.markRead('wt-_work_repo__term-1');

    expect(windowA.get('wt-_work_repo__term-1')).toEqual({
      status: 'completed',
      statusAt: 1710000000,
      unread: false,
    });
    await vi.waitFor(() => {
      expect(windowB.get('wt-_work_repo__term-1')).toEqual({
        status: 'completed',
        statusAt: 1710000000,
        unread: false,
      });
    }, WATCH_EVENT_WAIT);
  });

  it('does not close status watchers during steady-state status and read-marker writes', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'wt-_work_repo__term-1.json'),
      '{"status":"completed","statusAt":1710000000}\n',
      'utf8',
    );
    const windowA = new AgentStatusStore(root, 10);
    const windowB = new AgentStatusStore(root, 10);
    disposables.push(await windowA.start());
    disposables.push(await windowB.start());
    const watcherCloseCount = spyOnWatcherCloses(windowB);

    writeFileSync(
      join(root, 'wt-_work_repo__term-1.json'),
      '{"status":"completed","statusAt":1710000001}\n',
      'utf8',
    );

    await vi.waitFor(() => {
      expect(windowB.get('wt-_work_repo__term-1')).toEqual({
        status: 'completed',
        statusAt: 1710000001,
        unread: true,
      });
    }, WATCH_EVENT_WAIT);

    await vi.waitFor(() => {
      expect(windowA.get('wt-_work_repo__term-1')).toEqual({
        status: 'completed',
        statusAt: 1710000001,
        unread: true,
      });
    }, WATCH_EVENT_WAIT);
    await windowA.markRead('wt-_work_repo__term-1');

    await vi.waitFor(() => {
      expect(windowB.get('wt-_work_repo__term-1')).toEqual({
        status: 'completed',
        statusAt: 1710000001,
        unread: false,
      });
    }, WATCH_EVENT_WAIT);
    expect(watcherCloseCount()).toBe(0);
  });

  it('persists completed read state through marker files', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'wt-_work_repo__term-1.json'),
      '{"status":"completed","statusAt":1710000000}\n',
      'utf8',
    );
    const firstStore = new AgentStatusStore(root, 10);
    disposables.push(await firstStore.start());

    await firstStore.markRead('wt-_work_repo__term-1');

    const secondStore = new AgentStatusStore(root, 10);
    disposables.push(await secondStore.start());

    expect(secondStore.get('wt-_work_repo__term-1')).toEqual({
      status: 'completed',
      statusAt: 1710000000,
      unread: false,
    });
  });

  it('ignores malformed and invalid status files', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'partial.json'), '{"status":"completed"', 'utf8');
    writeFileSync(join(root, 'unknown.json'), '{"status":"working","statusAt":1710000000}', 'utf8');
    const store = new AgentStatusStore(root, 10);
    disposables.push(await store.start());

    expect(store.get('partial')).toBeUndefined();
    expect(store.get('unknown')).toBeUndefined();
  });

  it('treats an empty message as absent', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'term-1.json'),
      '{"status":"needsInput","statusAt":1710000000,"message":""}',
      'utf8',
    );
    const store = new AgentStatusStore(root, 10);
    disposables.push(await store.start());

    expect(store.get('term-1')).toEqual({ status: 'needsInput', statusAt: 1710000000 });
  });

  it('loads all hook statuses and keeps the needs-input message', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'working.json'), '{"status":"inProgress","statusAt":1710000000}', 'utf8');
    writeFileSync(
      join(root, 'waiting.json'),
      '{"status":"needsInput","statusAt":1710000001,"message":"Allow Bash?"}',
      'utf8',
    );
    writeFileSync(join(root, 'done.json'), '{"status":"completed","statusAt":1710000002}', 'utf8');
    writeFileSync(join(root, 'failed.json'), '{"status":"failed","statusAt":1710000003}', 'utf8');
    const store = new AgentStatusStore(root, 10);
    disposables.push(await store.start());

    expect(store.get('working')).toEqual({ status: 'inProgress', statusAt: 1710000000 });
    expect(store.get('waiting')).toEqual({
      status: 'needsInput',
      statusAt: 1710000001,
      message: 'Allow Bash?',
    });
    expect(store.get('done')).toEqual({ status: 'completed', statusAt: 1710000002, unread: true });
    expect(store.get('failed')).toEqual({ status: 'failed', statusAt: 1710000003 });
  });

  it('stays silent on statusAt-only churn for non-completed statuses', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'term-1.json'), '{"status":"inProgress","statusAt":1710000000}', 'utf8');
    const store = new AgentStatusStore(root, 10);
    const changes = vi.fn();
    disposables.push(store.onDidChange(changes));
    disposables.push(await store.start());

    writeFileSync(join(root, 'term-1.json'), '{"status":"inProgress","statusAt":1710000050}', 'utf8');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(changes).not.toHaveBeenCalled();

    writeFileSync(join(root, 'term-1.json'), '{"status":"completed","statusAt":1710000060}', 'utf8');
    await vi.waitFor(() => expect(changes).toHaveBeenCalled(), WATCH_EVENT_WAIT);
  });

  it('removes a single session status on Deck-owned kills and notifies listeners', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'killed.json'), '{"status":"completed","statusAt":1710000000}', 'utf8');
    const store = new AgentStatusStore(root, 10);
    const changes = vi.fn();
    disposables.push(store.onDidChange(changes));
    disposables.push(await store.start());
    await store.markRead('killed');

    await store.remove('killed');

    expect(store.get('killed')).toBeUndefined();
    expect(existsSync(join(root, 'killed.json'))).toBe(false);
    expect(existsSync(join(`${root}-reads`, 'killed.json'))).toBe(false);
    expect(changes).toHaveBeenCalled();

    await expect(store.remove('killed')).resolves.toBeUndefined();
  });

  it('removes status and read marker files for Terminal sessions that no longer exist', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'live.json'), '{"status":"inProgress","statusAt":1710000000}', 'utf8');
    writeFileSync(join(root, 'dead.json'), '{"status":"completed","statusAt":1710000001}', 'utf8');
    const store = new AgentStatusStore(root, 10);
    disposables.push(await store.start());
    await store.markRead('dead');

    await store.prune(new Set(['live']));

    expect(store.get('live')).toEqual({ status: 'inProgress', statusAt: 1710000000 });
    expect(store.get('dead')).toBeUndefined();
    expect(existsSync(join(root, 'live.json'))).toBe(true);
    expect(existsSync(join(root, 'dead.json'))).toBe(false);
    expect(existsSync(join(`${root}-reads`, 'dead.json'))).toBe(false);
  });

  it('removes a read marker when its status file is removed externally', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'done.json'), '{"status":"completed","statusAt":1710000000}', 'utf8');
    const store = new AgentStatusStore(root, 10);
    disposables.push(await store.start());
    await store.markRead('done');

    rmSync(join(root, 'done.json'), { force: true });

    await vi.waitFor(() => {
      expect(store.get('done')).toBeUndefined();
      expect(existsSync(join(`${root}-reads`, 'done.json'))).toBe(false);
    }, WATCH_EVENT_WAIT);
  });

  it('keeps reading statuses and read markers after the status area is removed and recreated', async () => {
    const root = tempRoot();
    const windowA = new AgentStatusStore(root, 10);
    const windowB = new AgentStatusStore(root, 10);
    disposables.push(await windowA.start());
    disposables.push(await windowB.start());

    rmSync(root, { recursive: true, force: true });
    rmSync(`${root}-reads`, { recursive: true, force: true });

    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'done.json'), '{"status":"completed","statusAt":1710000000}', 'utf8');

    await vi.waitFor(() => {
      expect(windowB.get('done')).toEqual({ status: 'completed', statusAt: 1710000000, unread: true });
    }, WATCH_EVENT_WAIT);

    writeFileSync(join(root, 'done.json'), '{"status":"completed","statusAt":1710000001}', 'utf8');

    await vi.waitFor(() => {
      expect(windowB.get('done')).toEqual({ status: 'completed', statusAt: 1710000001, unread: true });
    }, WATCH_EVENT_WAIT);

    await vi.waitFor(() => {
      expect(windowA.get('done')).toEqual({ status: 'completed', statusAt: 1710000001, unread: true });
    }, WATCH_EVENT_WAIT);
    await windowA.markRead('done');

    await vi.waitFor(() => {
      expect(windowB.get('done')).toEqual({ status: 'completed', statusAt: 1710000001, unread: false });
    }, WATCH_EVENT_WAIT);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deck-agent-status-'));
  tempRoots.push(root);
  tempRoots.push(`${root}-reads`);
  return root;
}

function spyOnWatcherCloses(store: AgentStatusStore): () => number {
  const watchers = Array.from(
    (store as unknown as { watchers: Map<string, { close(): void }> }).watchers.values(),
  );
  const spies = watchers.map((watcher) => vi.spyOn(watcher, 'close'));
  return () => spies.reduce((count, spy) => count + spy.mock.calls.length, 0);
}
