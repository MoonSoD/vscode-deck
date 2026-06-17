import { join } from 'node:path';
import type { AgentStatus } from './agentStatusStore';
import type { AgentName } from './agentTypes';

export type AgentIconState = 'identity' | 'working';

const AGENT_IDENTITY_ICONS: Record<AgentName, string> = {
  claude: 'claude-code.png',
  codex: 'codex-code.png',
};

export interface AgentIconFactory<TUri, TThemeIcon> {
  uriFile(path: string): TUri;
  themeIcon(id: string): TThemeIcon;
}

export interface AgentIconInput {
  windowName: string;
  resourcesDir: string;
  status?: AgentStatus;
}

export type ResolvedAgentIcon<TUri = { fsPath: string }, TThemeIcon = { id: string }> =
  | {
    iconPath: TUri;
    isAgent: true;
    agent: AgentName;
    state: 'identity';
  }
  | {
    iconPath: TThemeIcon;
    isAgent: true;
    agent: AgentName;
    state: 'working';
  }
  | {
    iconPath: TThemeIcon;
    isAgent: false;
  };

const defaultIconFactory: AgentIconFactory<{ fsPath: string }, { id: string }> = {
  uriFile: (fsPath) => ({ fsPath }),
  themeIcon: (id) => ({ id }),
};

export function resolveAgentIcon<TUri = { fsPath: string }, TThemeIcon = { id: string }>(
  input: AgentIconInput,
  factory: AgentIconFactory<TUri, TThemeIcon> = defaultIconFactory as AgentIconFactory<TUri, TThemeIcon>,
): ResolvedAgentIcon<TUri, TThemeIcon> {
  const agent = agentFromWindowName(input.windowName) ?? agentFromStatus(input.status);
  if (agent === undefined) {
    return {
      iconPath: factory.themeIcon('terminal'),
      isAgent: false,
    };
  }

  const state = iconStateFromStatus(input.status);
  if (state === 'working') {
    return {
      iconPath: factory.themeIcon('loading~spin'),
      isAgent: true,
      agent,
      state,
    };
  }

  return {
    iconPath: factory.uriFile(join(input.resourcesDir, AGENT_IDENTITY_ICONS[agent])),
    isAgent: true,
    agent,
    state,
  };
}

function agentFromWindowName(windowName: string): AgentName | undefined {
  if (windowName === 'claude' || windowName === 'codex') return windowName;
  return undefined;
}

function agentFromStatus(status?: AgentStatus): AgentName | undefined {
  if (status === undefined) return undefined;
  // The status record carries the agent that wrote it; trust it over a stale
  // window name so a Codex row never falls back to the Claude mark.
  return status.agent ?? 'claude';
}

function iconStateFromStatus(status?: AgentStatus): AgentIconState {
  if (status?.status === 'inProgress') return 'working';
  return 'identity';
}
