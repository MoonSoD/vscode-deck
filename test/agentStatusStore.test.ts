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
    const storage = new MemoryMemento();
    const store = new AgentStatusStore(root, 10, storage);
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

  it('persists completed read state through injected storage', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'wt-_work_repo__term-1.json'),
      '{"status":"completed","statusAt":1710000000}\n',
      'utf8',
    );
    const storage = new MemoryMemento();
    const firstStore = new AgentStatusStore(root, 10, storage);
    disposables.push(await firstStore.start());

    await firstStore.markRead('wt-_work_repo__term-1');

    const secondStore = new AgentStatusStore(root, 10, storage);
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

  it('removes status files for Terminal sessions that no longer exist', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'live.json'), '{"status":"inProgress","statusAt":1710000000}', 'utf8');
    writeFileSync(join(root, 'dead.json'), '{"status":"completed","statusAt":1710000001}', 'utf8');
    const store = new AgentStatusStore(root, 10);
    disposables.push(await store.start());

    await store.prune(new Set(['live']));

    expect(store.get('live')).toEqual({ status: 'inProgress', statusAt: 1710000000 });
    expect(store.get('dead')).toBeUndefined();
    expect(existsSync(join(root, 'live.json'))).toBe(true);
    expect(existsSync(join(root, 'dead.json'))).toBe(false);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deck-agent-status-'));
  tempRoots.push(root);
  return root;
}

class MemoryMemento {
  private readonly values: Record<string, unknown> = {};

  get<T>(key: string, defaultValue: T): T {
    return (this.values[key] as T | undefined) ?? defaultValue;
  }

  async update(key: string, value: unknown): Promise<void> {
    this.values[key] = value;
  }
}
