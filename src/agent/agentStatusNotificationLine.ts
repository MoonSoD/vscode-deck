export type AgentStatusNotificationSeverity = 'warning' | 'information';

export interface AgentStatusNotificationLocation {
  repo: string;
  branch: string;
}

export interface AgentStatusNotificationLineInput {
  status: 'needsInput' | 'completed';
  agentName: string;
  label: string;
  message?: string;
  location?: AgentStatusNotificationLocation;
}

export interface AgentStatusNotificationLine {
  severity: AgentStatusNotificationSeverity;
  text: string;
}

export function composeAgentStatusNotificationLine(
  input: AgentStatusNotificationLineInput,
): AgentStatusNotificationLine {
  const detail = input.message ?? (input.status === 'needsInput' ? 'needs input' : 'finished');
  const label = input.label.trim() || input.agentName;
  const identity = input.location === undefined
    ? label
    : `${input.location.repo}/${input.location.branch} · ${label}`;

  return {
    severity: input.status === 'needsInput' ? 'warning' : 'information',
    text: `${input.status === 'needsInput' ? '⚠' : 'ⓘ'} ${identity} · ${detail}`,
  };
}
