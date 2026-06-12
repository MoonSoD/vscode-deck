import type { AgentName } from './agentTypes';

export interface AgentSidecar {
  agent: AgentName;
  session_id: string;
  pid: number;
  startTime: string;
}
