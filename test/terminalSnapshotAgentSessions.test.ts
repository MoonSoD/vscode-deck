import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentSidecarStore } from '../src/agent/agentSidecarStore';
import { rewriteTerminalSnapshotAgentSessions } from '../src/agent/terminalSnapshotAgentSessions';

const tempRoots: string[] = [];

describe('rewriteTerminalSnapshotAgentSessions', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rewrites the latest resurrect snapshot with sidecars from the store', async () => {
    const root = tempRoot();
    const snapshotPath = join(root, 'resurrect', 'last');
    const sidecarStore = new AgentSidecarStore(join(root, 'hooks'));
    mkdirSync(join(root, 'resurrect'), { recursive: true });
    writeFileSync(snapshotPath, [
      'pane\twt-_work_repo__term-1\t0\t1\t:*\t0\t%0\t:/work/repo\t1\tclaude\t:claude',
      'window\twt-_work_repo__term-1\t0\tzsh\t1\t:*\tlayout\ton',
    ].join('\n'), 'utf8');
    await sidecarStore.write('wt-_work_repo__term-1', { agent: 'claude', session_id: 'abc-123' });

    await rewriteTerminalSnapshotAgentSessions(snapshotPath, sidecarStore);

    expect(readFileSync(snapshotPath, 'utf8')).toBe([
      'pane\twt-_work_repo__term-1\t0\t1\t:*\t0\t%0\t:/work/repo\t1\tclaude\t:claude --resume abc-123',
      'window\twt-_work_repo__term-1\t0\tzsh\t1\t:*\tlayout\ton',
    ].join('\n'));
  });

  it('does nothing when there is no latest snapshot yet', async () => {
    const root = tempRoot();

    await expect(
      rewriteTerminalSnapshotAgentSessions(
        join(root, 'resurrect', 'last'),
        new AgentSidecarStore(join(root, 'hooks')),
      ),
    ).resolves.toBeUndefined();
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deck-terminal-agent-snapshot-'));
  tempRoots.push(root);
  return root;
}
