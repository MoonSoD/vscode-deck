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

interface AgentStatusNotificationFormat {
  severity: AgentStatusNotificationSeverity;
  icon: string;
  fallbackDetail: string;
}

export function composeAgentStatusNotificationLine(
  input: AgentStatusNotificationLineInput,
): AgentStatusNotificationLine {
  const format = notificationFormat(input.status);
  const detail = input.message ?? format.fallbackDetail;
  const label = input.label.trim() || input.agentName;
  const segments = [label, detail];
  if (input.location !== undefined) {
    segments.unshift(`${input.location.repo}/${input.location.branch}`);
  }

  return {
    severity: format.severity,
    text: `${format.icon} ${segments.join(' · ')}`,
  };
}

function notificationFormat(status: AgentStatusNotificationLineInput['status']): AgentStatusNotificationFormat {
  switch (status) {
    case 'needsInput':
      return { severity: 'warning', icon: '⚠', fallbackDetail: 'needs input' };
    case 'completed':
      return { severity: 'information', icon: 'ⓘ', fallbackDetail: 'finished' };
  }
}
