import { describe, expect, it, vi } from 'vitest';
import { AgentExitSweep, type AgentExitSidecarStore, type AgentExitStatusStore } from '../src/agent/agentExitSweep';
import type { AgentProcessIdentity } from '../src/agent/agentLivenessProbe';
import type { AgentSidecar } from '../src/agent/agentSidecar';

describe('AgentExitSweep', () => {
  it('removes dead agent sidecars, keeps live ones, and no-ops when there are no sidecars', async () => {
    const liveness = vi.fn(async (process: AgentProcessIdentity) => process.pid === 222);
    const sidecars = new SidecarStore([
      ['term-1', sidecar('codex', 'codex-123', 111, 'Thu Jun 11 20:00:00 2026')],
      ['term-2', sidecar('claude', 'claude-123', 222, 'Thu Jun 11 20:00:01 2026')],
    ]);
    const statuses = new StatusStore();
    const teardown = {
      restoreAutomaticRename: vi.fn(async () => undefined),
    };
    const sweep = new AgentExitSweep({
      sidecars,
      statuses,
      liveness: { isAgentAlive: liveness },
      teardown,
    });

    await expect(sweep.runOnce()).resolves.toBe(true);

    expect(liveness).toHaveBeenCalledWith({ pid: 111, startTime: 'Thu Jun 11 20:00:00 2026' });
    expect(liveness).toHaveBeenCalledWith({ pid: 222, startTime: 'Thu Jun 11 20:00:01 2026' });
    expect(teardown.restoreAutomaticRename).toHaveBeenCalledWith('term-1');
    expect(sidecars.removed).toEqual(['term-1']);
    expect(statuses.removed).toEqual(['term-1']);

    sidecars.records = [];
    await expect(sweep.runOnce()).resolves.toBe(false);

    expect(liveness).toHaveBeenCalledTimes(2);
  });
});

class SidecarStore implements AgentExitSidecarStore {
  removed: string[] = [];

  constructor(public records: Array<[string, AgentSidecar]>) {}

  async readAll(): Promise<Map<string, AgentSidecar>> {
    return new Map(this.records);
  }

  async remove(sessionName: string): Promise<void> {
    this.removed.push(sessionName);
  }
}

class StatusStore implements AgentExitStatusStore {
  removed: string[] = [];

  async remove(sessionName: string): Promise<void> {
    this.removed.push(sessionName);
  }
}

function sidecar(agent: AgentSidecar['agent'], session_id: string, pid: number, startTime: string): AgentSidecar {
  return {
    agent,
    session_id,
    pid,
    startTime,
  };
}
