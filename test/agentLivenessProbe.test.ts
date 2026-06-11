import { describe, expect, it } from 'vitest';
import { AgentLivenessProbe, type ProcessProbe } from '../src/agent/agentLivenessProbe';
import type { AgentName } from '../src/agent/agentTypes';

class FakeProcessProbe implements ProcessProbe {
  constructor(
    private readonly process: {
      alive: boolean;
      startTime: string;
      command: string;
    },
  ) {}

  async isAlive(): Promise<boolean> {
    return this.process.alive;
  }

  async startTime(): Promise<string> {
    return this.process.startTime;
  }

  async command(): Promise<string> {
    return this.process.command;
  }
}

describe('AgentLivenessProbe', () => {
  it.each([
    ['alive pid', { alive: true, startTime: 'Thu Jun 11 20:00:00 2026', command: '/usr/local/bin/codex' }, true],
    ['wrapped agent command', { alive: true, startTime: 'Thu Jun 11 20:00:00 2026', command: 'node /opt/codex/bin/codex.js' }, true],
    ['dead pid', { alive: false, startTime: 'Thu Jun 11 20:00:00 2026', command: '/usr/local/bin/codex' }, false],
    ['reused pid', { alive: true, startTime: 'Thu Jun 11 20:01:00 2026', command: '/usr/local/bin/codex' }, false],
    ['wrong command', { alive: true, startTime: 'Thu Jun 11 20:00:00 2026', command: '/bin/bash' }, false],
  ])('%s reports %s', async (_name, process, expected) => {
    const probe = new AgentLivenessProbe(new FakeProcessProbe(process));

    await expect(probe.isAgentAlive({
      agent: 'codex' satisfies AgentName,
      pid: 1234,
      startTime: 'Thu Jun 11 20:00:00 2026',
    })).resolves.toBe(expected);
  });
});
