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

  // No leading severity glyph: VS Code renders its own warning/info codicon on
  // the toast (driven by which show*Message we call), so the `severity` field
  // is the only icon source — a literal glyph here would double it.
  return {
    severity: format.severity,
    text: segments.join(' · '),
  };
}

function notificationFormat(status: AgentStatusNotificationLineInput['status']): AgentStatusNotificationFormat {
  switch (status) {
    case 'needsInput':
      return { severity: 'warning', fallbackDetail: 'needs input' };
    case 'completed':
      return { severity: 'information', fallbackDetail: 'finished' };
  }
}
