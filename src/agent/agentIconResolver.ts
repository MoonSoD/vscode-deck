import { join } from 'node:path';
import type { AgentStatus } from './agentStatusStore';
import type { AgentName } from './agentTypes';

type AgentIconState = 'identity' | 'working';

const AGENT_ICONS: Record<AgentName, { identity: string; working: string }> = {
  claude: {
    identity: 'claude-code.png',
    working: 'claude-working.gif',
  },
  codex: {
    identity: 'codex-code.png',
    working: 'codex-working.gif',
  },
};

export interface AgentIconFactory<TUri, TThemeIcon> {
  uriFile(path: string): TUri;
  themeIcon(id: string): TThemeIcon;
}

export interface ResolvedAgentIcon<TUri = { fsPath: string }, TThemeIcon = { id: string }> {
  iconPath: TUri | TThemeIcon;
  isAgent: boolean;
  agent?: AgentName;
  state?: AgentIconState;
}

const defaultIconFactory: AgentIconFactory<{ fsPath: string }, { id: string }> = {
  uriFile: (fsPath) => ({ fsPath }),
  themeIcon: (id) => ({ id }),
};

export function resolveAgentIcon<TUri = { fsPath: string }, TThemeIcon = { id: string }>(input: {
  windowName: string;
  resourcesDir: string;
  status?: AgentStatus;
}, factory: AgentIconFactory<TUri, TThemeIcon> = defaultIconFactory as AgentIconFactory<TUri, TThemeIcon>):
  ResolvedAgentIcon<TUri, TThemeIcon> {
  const agent = agentFromWindowName(input.windowName) ?? (input.status === undefined ? undefined : 'claude');
  if (agent !== undefined) {
    const icons = AGENT_ICONS[agent];
    const state = input.status?.status === 'inProgress' ? 'working' : 'identity';
    const iconFile = state === 'working' ? icons.working : icons.identity;
    return {
      iconPath: factory.uriFile(join(input.resourcesDir, iconFile)),
      isAgent: true,
      agent,
      state,
    };
  }

  return {
    iconPath: factory.themeIcon('terminal'),
    isAgent: false,
  };
}

function agentFromWindowName(windowName: string): AgentName | undefined {
  if (windowName === 'claude' || windowName === 'codex') return windowName;
  return undefined;
}
