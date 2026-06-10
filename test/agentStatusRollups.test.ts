import { describe, expect, it } from 'vitest';
import {
  countNeedsInputStatuses,
  describeNeedsInputBadge,
} from '../src/agent/agentStatusRollups';

describe('countNeedsInputStatuses', () => {
  it('counts only needs-input statuses', () => {
    expect(countNeedsInputStatuses([
      { status: 'needsInput', statusAt: 1710000000 },
      { status: 'completed', statusAt: 1710000001 },
      { status: 'inProgress', statusAt: 1710000002 },
      { status: 'failed', statusAt: 1710000003 },
      { status: 'needsInput', statusAt: 1710000004 },
    ])).toBe(2);
  });
});

describe('describeNeedsInputBadge', () => {
  it('returns no badge for zero needs-input statuses', () => {
    expect(describeNeedsInputBadge(0)).toBeUndefined();
  });

  it('describes singular and plural needs-input badges', () => {
    expect(describeNeedsInputBadge(1)).toEqual({
      value: 1,
      tooltip: '1 agent needs input',
    });
    expect(describeNeedsInputBadge(2)).toEqual({
      value: 2,
      tooltip: '2 agents need input',
    });
  });
});
