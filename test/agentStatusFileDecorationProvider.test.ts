import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    readonly event = vi.fn();
    fire = vi.fn();
    dispose = vi.fn();
  },
  FileDecoration: class {
    propagate?: boolean;

    constructor(
      readonly badge?: string,
      readonly tooltip?: string,
      readonly color?: { id: string },
    ) {}
  },
  ThemeColor: class {
    constructor(readonly id: string) {}
  },
}));

import { AgentStatusDecorationRollups, agentStatusDecorationUri } from '../src/agent/agentStatusDecorations';
import { AgentStatusFileDecorationProvider } from '../src/agent/agentStatusFileDecorationProvider';
import type { AgentStatus } from '../src/agent/agentStatusStore';

describe('AgentStatusFileDecorationProvider', () => {
  it('returns file decorations for deck-status attention rows only', () => {
    const statuses = new Map<string, AgentStatus>([
      ['term-1', { status: 'needsInput', statusAt: 1710000000, message: 'Allow Bash(ls)?' }],
      ['term-2', { status: 'completed', statusAt: 1710000001, unread: false }],
    ]);
    const rollups = new AgentStatusDecorationRollups();
    rollups.setTerminals([
      { repositoryPath: '/repo', worktreePath: '/repo/main', sessionName: 'term-1' },
      { repositoryPath: '/repo', worktreePath: '/repo/main', sessionName: 'term-2' },
    ]);
    const provider = new AgentStatusFileDecorationProvider({
      entries: () => statuses.entries(),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    }, rollups);

    expect(provider.provideFileDecoration(agentStatusDecorationUri('terminal', 'term-1') as never)).toEqual({
      badge: '•',
      tooltip: 'Input needed: Allow Bash(ls)?',
      color: { id: 'list.warningForeground' },
      propagate: false,
    });
    expect(provider.provideFileDecoration(agentStatusDecorationUri('terminal', 'term-2') as never)).toBeUndefined();
    expect(provider.provideFileDecoration({ scheme: 'file', path: '/tmp/term-1' } as never)).toBeUndefined();
  });
});
