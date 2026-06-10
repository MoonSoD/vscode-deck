import type { AgentStatus } from './agentStatusStore';

export interface NeedsInputBadgeDescription {
  value: number;
  tooltip: string;
}

export function countNeedsInputStatuses(statuses: Iterable<AgentStatus | undefined>): number {
  let count = 0;
  for (const status of statuses) {
    if (status?.status === 'needsInput') count += 1;
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
