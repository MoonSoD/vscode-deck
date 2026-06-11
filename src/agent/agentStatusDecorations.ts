import type { AgentStatus } from './agentStatusStore';

export const agentStatusDecorationScheme = 'deck-status';

export interface AgentStatusDecorationUri {
  scheme: string;
  path: string;
}

export interface AgentStatusDecoration {
  badge: '●';
  colorId: 'list.warningForeground' | 'textLink.foreground' | 'errorForeground';
  tooltip: string;
}

export type AgentStatusDecorationNodeKind = 'repository' | 'worktree' | 'terminal';

export interface AgentStatusDecorationTerminal {
  repositoryPath: string;
  worktreePath: string;
  sessionName: string;
}

type AttentionStatus = AgentStatus & (
  | { status: 'needsInput' }
  | { status: 'failed' }
  | { status: 'completed' }
);

export function agentStatusDecorationUri(
  kindOrSessionName: AgentStatusDecorationNodeKind | string,
  id?: string,
): AgentStatusDecorationUri {
  const kind = id === undefined ? 'terminal' : kindOrSessionName as AgentStatusDecorationNodeKind;
  const value = id ?? kindOrSessionName;
  return {
    scheme: agentStatusDecorationScheme,
    path: `/${kind}/${encodeURIComponent(value)}`,
  };
}

export function parseAgentStatusDecorationUri(
  uri: AgentStatusDecorationUri,
): { kind: AgentStatusDecorationNodeKind; id: string } | undefined {
  if (uri.scheme !== agentStatusDecorationScheme) return undefined;
  const match = uri.path.match(/^\/(repository|worktree|terminal)\/(.+)$/);
  if (!match) return undefined;
  return {
    kind: match[1] as AgentStatusDecorationNodeKind,
    id: decodeURIComponent(match[2]),
  };
}

export function provideAgentStatusDecoration(
  uri: AgentStatusDecorationUri,
  status: AgentStatus | undefined,
): AgentStatusDecoration | undefined {
  if (uri.scheme !== agentStatusDecorationScheme) return undefined;
  if (status?.status === 'needsInput') {
    return {
      badge: '●',
      colorId: 'list.warningForeground',
      tooltip: statusTooltip('Input needed', status.message),
    };
  }
  if (status?.status === 'completed' && status.unread !== false) {
    return {
      badge: '●',
      colorId: 'textLink.foreground',
      tooltip: statusTooltip('Completed', status.message),
    };
  }
  if (status?.status === 'failed') {
    return {
      badge: '●',
      colorId: 'errorForeground',
      tooltip: statusTooltip('Failed', status.message),
    };
  }
  return undefined;
}

function statusTooltip(label: string, message: string | undefined): string {
  return message ? `${label}: ${message}` : label;
}

export class AgentStatusDecorationRollups {
  private terminals: AgentStatusDecorationTerminal[] = [];
  private readonly statuses = new Map<string, AgentStatus>();
  private readonly collapsedRepositories = new Set<string>();
  private readonly collapsedWorktrees = new Set<string>();

  setTerminals(terminals: readonly AgentStatusDecorationTerminal[]): void {
    this.terminals = [...terminals];
  }

  setStatuses(statuses: Iterable<readonly [string, AgentStatus]>): void {
    this.statuses.clear();
    for (const [sessionName, status] of statuses) {
      this.statuses.set(sessionName, status);
    }
  }

  setStatus(sessionName: string, status: AgentStatus | undefined): void {
    if (status === undefined) {
      this.statuses.delete(sessionName);
      return;
    }
    this.statuses.set(sessionName, status);
  }

  setCollapsed(kind: Exclude<AgentStatusDecorationNodeKind, 'terminal'>, id: string, collapsed: boolean): void {
    const collapsedSet = kind === 'repository' ? this.collapsedRepositories : this.collapsedWorktrees;
    if (collapsed) {
      collapsedSet.add(id);
    } else {
      collapsedSet.delete(id);
    }
  }

  getDecorationStatus(kind: AgentStatusDecorationNodeKind, id: string): AgentStatus | undefined {
    return mostUrgent(
      this.terminals.flatMap((terminal) => {
        if (this.decorationTarget(terminal) !== nodeKey(kind, id)) return [];
        const status = attentionStatus(this.statuses.get(terminal.sessionName));
        return status === undefined ? [] : [status];
      }),
    );
  }

  private decorationTarget(terminal: AgentStatusDecorationTerminal): string {
    if (this.collapsedRepositories.has(terminal.repositoryPath)) {
      return nodeKey('repository', terminal.repositoryPath);
    }
    if (this.collapsedWorktrees.has(terminal.worktreePath)) {
      return nodeKey('worktree', terminal.worktreePath);
    }
    return nodeKey('terminal', terminal.sessionName);
  }
}

function nodeKey(kind: AgentStatusDecorationNodeKind, id: string): string {
  return `${kind}:${id}`;
}

function attentionStatus(status: AgentStatus | undefined): AttentionStatus | undefined {
  if (status?.status === 'needsInput') return status as AttentionStatus;
  if (status?.status === 'failed') return status as AttentionStatus;
  if (status?.status === 'completed' && status.unread !== false) return status as AttentionStatus;
  return undefined;
}

function mostUrgent(statuses: readonly AttentionStatus[]): AttentionStatus | undefined {
  return statuses.reduce<AttentionStatus | undefined>((mostUrgentStatus, status) => {
    if (mostUrgentStatus === undefined || urgency(status) > urgency(mostUrgentStatus)) return status;
    return mostUrgentStatus;
  }, undefined);
}

function urgency(status: AttentionStatus): number {
  if (status.status === 'needsInput') return 3;
  if (status.status === 'failed') return 2;
  return 1;
}
