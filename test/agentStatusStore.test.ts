import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentStatusStore } from '../src/agent/agentStatusStore';

const tempRoots: string[] = [];
const disposables: Array<{ dispose(): void }> = [];

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
      });
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
      });
    });
    expect(changes).toHaveBeenCalled();
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
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deck-agent-status-'));
  tempRoots.push(root);
  return root;
}
