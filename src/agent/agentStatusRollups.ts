import type { AgentStatus } from './agentStatusStore';

export interface NeedsInputBadgeDescription {
  value: number;
  tooltip: string;
}

export function countNeedsInputStatuses(statuses: Iterable<AgentStatus | undefined>): number {
  let count = 0;
  for (const status of statuses) {
    if (isNeedsInput(status)) count += 1;
  }
  return count;
}

export function countNeedsInputStatusesForSessionPrefix(
  statuses: Iterable<readonly [string, AgentStatus]>,
  sessionNamePrefix: string,
): number {
  let count = 0;
  for (const [sessionName, status] of statuses) {
    if (sessionName.startsWith(sessionNamePrefix) && isNeedsInput(status)) count += 1;
  }
  return count;
}

export function describeNeedsInputBadge(count: number): NeedsInputBadgeDescription | undefined {
  if (count <= 0) return undefined;
  return {
    value: count,
    tooltip: count === 1 ? '1 agent needs input' : `${count} agents need input`,
  };
}

function isNeedsInput(status: AgentStatus | undefined): boolean {
  return status?.status === 'needsInput';
}
