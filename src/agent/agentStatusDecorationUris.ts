export const agentStatusDecorationScheme = 'deck-status';

export interface AgentStatusDecorationUri {
  scheme: string;
  path: string;
}

export interface AgentStatusDecorationResourceUri {
  scheme: string;
  authority: string;
  path: string;
  query: string;
}

export type AgentStatusDecorationNodeKind = 'repository' | 'worktree' | 'terminal';

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

export function agentStatusDecorationResourceUri(
  kind: AgentStatusDecorationNodeKind,
  id: string,
): AgentStatusDecorationResourceUri {
  const uri = agentStatusDecorationUri(kind, id);
  return {
    scheme: uri.scheme,
    authority: '',
    path: uri.path,
    query: '',
  };
}
