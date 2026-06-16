import { describe, expect, it } from 'vitest';
import { composeAgentStatusNotificationLine } from '../src/agent/agentStatusNotificationLine';

describe('composeAgentStatusNotificationLine', () => {
  it('puts the tree labels before the agent ask for needs-input notifications', () => {
    expect(composeAgentStatusNotificationLine({
      status: 'needsInput',
      agentName: 'claude',
      label: 'fix-dlq-requeue-uploads-deadline',
      message: 'Claude needs your permission to use Bash',
      location: { repo: 'vscode-deck', branch: 'main' },
    })).toEqual({
      severity: 'warning',
      text: 'vscode-deck/main · fix-dlq-requeue-uploads-deadline · Claude needs your permission to use Bash',
    });
  });

  it('omits the location prefix and synthesizes finished for completed notifications', () => {
    expect(composeAgentStatusNotificationLine({
      status: 'completed',
      agentName: 'codex',
      label: 'reconcile checkout state',
    })).toEqual({
      severity: 'information',
      text: 'reconcile checkout state · finished',
    });
  });

  it('synthesizes needs input when an agent ask is absent', () => {
    expect(composeAgentStatusNotificationLine({
      status: 'needsInput',
      agentName: 'claude',
      label: 'claude',
      location: { repo: 'vscode-deck', branch: 'feature' },
    })).toEqual({
      severity: 'warning',
      text: 'vscode-deck/feature · claude · needs input',
    });
  });

  it('uses the agent identity when the label is blank', () => {
    expect(composeAgentStatusNotificationLine({
      status: 'completed',
      agentName: 'codex',
      label: '',
      location: { repo: 'vscode-deck', branch: 'main' },
    })).toEqual({
      severity: 'information',
      text: 'vscode-deck/main · codex · finished',
    });
  });
});
