import { describe, expect, it, vi } from 'vitest';
import { AgentExitSweep, type AgentExitPane, type AgentExitStatusStore } from '../src/agent/agentExitSweep';
import type { AgentProcessIdentity } from '../src/agent/agentLivenessProbe';
import type { AgentStatus } from '../src/agent/agentStatusStore';

describe('AgentExitSweep', () => {
  it('tears down dead agent panes, ignores live ones, and does no status work without agent panes', async () => {
    const deadStatus = status({ agent: 'codex', pid: 111, startTime: 'Thu Jun 11 20:00:00 2026' });
    const liveStatus = status({ agent: 'claude', pid: 222, startTime: 'Thu Jun 11 20:00:01 2026' });
    const liveness = vi.fn(async (process: AgentProcessIdentity) => process.pid === 222);
    const panes = new PaneSource([
      { sessionName: 'term-1', windowName: 'codex' },
      { sessionName: 'term-2', windowName: 'claude' },
      { sessionName: 'term-3', windowName: 'zsh' },
    ]);
    const statuses = new StatusStore([
      ['term-1', deadStatus],
      ['term-2', liveStatus],
    ]);
    const teardown = {
      restoreAutomaticRename: vi.fn(async () => undefined),
    };
    const sweep = new AgentExitSweep({
      panes,
      statuses,
      liveness: { isAgentAlive: liveness },
      teardown,
    });

    await expect(sweep.runOnce()).resolves.toBe(true);

    expect(liveness).toHaveBeenCalledTimes(2);
    expect(teardown.restoreAutomaticRename).toHaveBeenCalledWith('term-1');
    expect(statuses.removed).toEqual(['term-1']);

    panes.sessions = [{ sessionName: 'term-3', windowName: 'zsh' }];
    statuses.reads = 0;
    await expect(sweep.runOnce()).resolves.toBe(false);

    expect(statuses.reads).toBe(0);
    expect(liveness).toHaveBeenCalledTimes(2);
  });

  it('does not keep the scheduler alive for an agent-named pane without pid metadata', async () => {
    const statuses = new StatusStore([
      ['term-1', { status: 'inProgress', statusAt: 1710000000, agent: 'codex' }],
    ]);
    const sweep = new AgentExitSweep({
      panes: new PaneSource([{ sessionName: 'term-1', windowName: 'codex' }]),
      statuses,
      liveness: { isAgentAlive: vi.fn(async () => true) },
      teardown: { restoreAutomaticRename: vi.fn(async () => undefined) },
    });

    await expect(sweep.runOnce()).resolves.toBe(false);
  });
});

class PaneSource {
  constructor(public sessions: AgentExitPane[]) {}

  async listSessions(): Promise<AgentExitPane[]> {
    return this.sessions;
  }
}

class StatusStore implements AgentExitStatusStore {
  reads = 0;
  removed: string[] = [];

  constructor(private readonly statuses: Array<[string, AgentStatus]>) {}

  get(sessionName: string): AgentStatus | undefined {
    this.reads += 1;
    return this.statuses.find(([name]) => name === sessionName)?.[1];
  }

  async remove(sessionName: string): Promise<void> {
    this.removed.push(sessionName);
  }
}

function status(process: AgentProcessIdentity): AgentStatus {
  return {
    status: 'inProgress',
    statusAt: 1710000000,
    agent: process.agent,
    pid: process.pid,
    startTime: process.startTime,
  };
}
