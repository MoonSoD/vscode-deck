import { join } from 'node:path';
import type { AgentStatus } from './agentStatusStore';
import type { AgentName } from './agentTypes';

export type AgentIconState = 'identity' | 'working';
export type AgentIconSurface = 'tree' | 'tab';

type AgentIconFiles = Record<AgentIconState, string>;
type AgentIconSurfaceFiles = Record<AgentIconSurface, AgentIconFiles>;

const AGENT_ICONS: Record<AgentName, AgentIconSurfaceFiles> = {
  claude: {
    tree: {
      identity: 'claude-code-padded.png',
      working: 'claude-working-padded.gif',
    },
    tab: {
      identity: 'claude-code-padded-center.png',
      working: 'claude-working-padded-center.gif',
    },
  },
  codex: {
    tree: {
      identity: 'codex-code-padded.png',
      working: 'codex-working-padded.gif',
    },
    tab: {
      identity: 'codex-code-padded-center.png',
      working: 'codex-working-padded-center.gif',
    },
  },
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
    state: AgentIconState;
    surface: AgentIconSurface;
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
      iconPath: factory.themeIcon('deck-terminal'),
      isAgent: false,
    };
  }

  const state = iconStateFromStatus(input.status);
  return {
    iconPath: factory.uriFile(join(input.resourcesDir, AGENT_ICONS[agent].tree[state])),
    isAgent: true,
    agent,
    state,
    surface: 'tree',
  };
}

export function resolveTerminalTabIcon<TUri = { fsPath: string }, TThemeIcon = { id: string }>(
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
  return {
    iconPath: factory.uriFile(join(input.resourcesDir, AGENT_ICONS[agent].tab[state])),
    isAgent: true,
    agent,
    state,
    surface: 'tab',
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
