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
import { terminalSessionName } from '../src/terminal/tmuxSafe';

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
    const provider = createProvider(statuses, rollups);

    expect(provider.provideFileDecoration(agentStatusDecorationUri('terminal', 'term-1') as never)).toEqual({
      badge: '•',
      tooltip: 'Input needed: Allow Bash(ls)?',
      color: { id: 'list.warningForeground' },
      propagate: false,
    });
    expect(provider.provideFileDecoration(agentStatusDecorationUri('terminal', 'term-2') as never)).toBeUndefined();
    expect(provider.provideFileDecoration({ scheme: 'file', path: '/tmp/term-1' } as never)).toBeUndefined();
  });

  it('returns Terminal editor-tab decorations from the tab session status', () => {
    const worktreePath = '/repo/main';
    const needsInput = terminalSessionName(worktreePath, 1);
    const completed = terminalSessionName(worktreePath, 2);
    const failed = terminalSessionName(worktreePath, 3);
    const statuses = new Map<string, AgentStatus>([
      [needsInput, { status: 'needsInput', statusAt: 1710000000, message: 'Allow Bash(ls)?' }],
      [completed, { status: 'completed', statusAt: 1710000001, unread: true, message: 'Done' }],
      [failed, { status: 'failed', statusAt: 1710000002, message: 'Exited 1' }],
    ]);
    const provider = createProvider(statuses);

    expect(provider.provideFileDecoration(terminalUri(worktreePath, 1) as never)).toEqual({
      badge: '•',
      tooltip: 'Input needed: Allow Bash(ls)?',
      color: { id: 'list.warningForeground' },
      propagate: false,
    });
    expect(provider.provideFileDecoration(terminalUri(worktreePath, 2) as never)).toEqual({
      badge: '•',
      tooltip: 'Completed: Done',
      color: { id: 'textLink.foreground' },
      propagate: false,
    });
    expect(provider.provideFileDecoration(terminalUri(worktreePath, 3) as never)).toEqual({
      badge: '•',
      tooltip: 'Failed: Exited 1',
      color: { id: 'errorForeground' },
      propagate: false,
    });
  });

  it('returns no Terminal editor-tab decoration without attention status', () => {
    const worktreePath = '/repo/main';
    const inProgress = terminalSessionName(worktreePath, 1);
    const completedRead = terminalSessionName(worktreePath, 2);
    const statuses = new Map<string, AgentStatus>([
      [inProgress, { status: 'inProgress', statusAt: 1710000000, message: 'Working' }],
      [completedRead, { status: 'completed', statusAt: 1710000001, unread: false, message: 'Done' }],
    ]);
    const provider = createProvider(statuses);

    expect(provider.provideFileDecoration(terminalUri(worktreePath, 1) as never)).toBeUndefined();
    expect(provider.provideFileDecoration(terminalUri(worktreePath, 2) as never)).toBeUndefined();
    expect(provider.provideFileDecoration(terminalUri(worktreePath, 3) as never)).toBeUndefined();
  });

  it('ignores malformed Terminal editor-tab URIs', () => {
    const provider = createProvider(new Map());

    expect(provider.provideFileDecoration({
      scheme: 'deck-terminal',
      authority: '',
      path: '/repo/main/not-a-terminal',
      query: '',
    } as never)).toBeUndefined();
    expect(provider.provideFileDecoration({
      scheme: 'deck-terminal',
      authority: 'session',
      path: '/repo/main/term-1',
      query: '',
    } as never)).toBeUndefined();
  });

  it('does not roll Terminal editor-tab decorations to collapsed rows', () => {
    const worktreePath = '/repo/main';
    const sessionName = terminalSessionName(worktreePath, 1);
    const statuses = new Map<string, AgentStatus>([
      [sessionName, { status: 'needsInput', statusAt: 1710000000, message: 'Review' }],
    ]);
    const rollups = new AgentStatusDecorationRollups();
    rollups.setTerminals([{ repositoryPath: '/repo', worktreePath, sessionName }]);
    rollups.setCollapsed('worktree', worktreePath, true);
    const provider = createProvider(statuses, rollups);

    expect(provider.provideFileDecoration(terminalUri(worktreePath, 1) as never)).toEqual({
      badge: '•',
      tooltip: 'Input needed: Review',
      color: { id: 'list.warningForeground' },
      propagate: false,
    });
    expect(provider.provideFileDecoration(agentStatusDecorationUri('terminal', sessionName) as never)).toBeUndefined();
  });
});

function createProvider(
  statuses: Map<string, AgentStatus>,
  rollups = new AgentStatusDecorationRollups(),
): AgentStatusFileDecorationProvider {
  return new AgentStatusFileDecorationProvider({
    get: (sessionName: string) => statuses.get(sessionName),
    entries: () => statuses.entries(),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
  }, rollups);
}

function terminalUri(worktreePath: string, term: number): {
  scheme: string;
  authority: string;
  path: string;
  query: string;
} {
  return {
    scheme: 'deck-terminal',
    authority: '',
    path: `${worktreePath}/term-${term}`,
    query: '',
  };
}
