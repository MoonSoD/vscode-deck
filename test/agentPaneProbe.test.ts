import { describe, expect, it, vi } from 'vitest';
import { AgentPaneProbe } from '../src/agent/agentPaneProbe';

describe('AgentPaneProbe', () => {
  it('resolves the live agent identity from the active pane shell child', async () => {
    const panes = {
      panePid: vi.fn(async () => 111),
    };
    const processes = {
      children: vi.fn(async () => [222]),
      startTime: vi.fn(async () => 'Thu Jun 11 20:02:00 2026'),
    };
    const probe = new AgentPaneProbe(panes, processes);

    await expect(probe.identityForSession('term-1')).resolves.toEqual({
      pid: 222,
      startTime: 'Thu Jun 11 20:02:00 2026',
    });
    expect(panes.panePid).toHaveBeenCalledWith('term-1');
    expect(processes.children).toHaveBeenCalledWith(111);
    expect(processes.startTime).toHaveBeenCalledWith(222);
  });

  it('returns undefined when the session has no active pane pid', async () => {
    const processes = {
      children: vi.fn(async () => [222]),
      startTime: vi.fn(async () => 'Thu Jun 11 20:02:00 2026'),
    };
    const probe = new AgentPaneProbe({ panePid: vi.fn(async () => undefined) }, processes);

    await expect(probe.identityForSession('term-1')).resolves.toBeUndefined();
    expect(processes.children).not.toHaveBeenCalled();
    expect(processes.startTime).not.toHaveBeenCalled();
  });

  it('returns undefined when the pane shell has no child process', async () => {
    const processes = {
      children: vi.fn(async () => []),
      startTime: vi.fn(async () => 'Thu Jun 11 20:02:00 2026'),
    };
    const probe = new AgentPaneProbe({ panePid: vi.fn(async () => 111) }, processes);

    await expect(probe.identityForSession('term-1')).resolves.toBeUndefined();
    expect(processes.startTime).not.toHaveBeenCalled();
  });

  it('returns undefined when the child start time cannot be read', async () => {
    const processes = {
      children: vi.fn(async () => [222]),
      startTime: vi.fn(async () => ''),
    };
    const probe = new AgentPaneProbe({ panePid: vi.fn(async () => 111) }, processes);

    await expect(probe.identityForSession('term-1')).resolves.toBeUndefined();
    expect(processes.startTime).toHaveBeenCalledWith(222);
  });
});
