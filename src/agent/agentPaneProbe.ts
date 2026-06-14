import type { AgentProcessIdentity, ProcessProbe } from './agentLivenessProbe';

export interface AgentPanePidSource {
  panePid(sessionName: string): Promise<number | undefined>;
}

export class AgentPaneProbe {
  constructor(
    private readonly panes: AgentPanePidSource,
    private readonly processes: Pick<ProcessProbe, 'children' | 'startTime'>,
  ) {}

  async identityForSession(sessionName: string): Promise<AgentProcessIdentity | undefined> {
    const panePid = await this.panes.panePid(sessionName);
    if (panePid === undefined) return undefined;

    const [agentPid] = await this.processes.children(panePid);
    if (agentPid === undefined) return undefined;

    const startTime = await this.processes.startTime(agentPid);
    if (!startTime) return undefined;

    return { pid: agentPid, startTime };
  }
}
