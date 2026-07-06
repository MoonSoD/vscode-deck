import { terminalSessionNumber } from './tmuxSafe';
import type { AgentName } from '../agent/agentTypes';

const AGENT_NAMES = new Set(['claude', 'codex']);
const LEADING_AGENT_TITLE_GLYPHS = /^[\u2800-\u28ff\u2700-\u27bf\s]+/u;

export function resolveTerminalLabel(
  windowName: string,
  paneTitle?: string,
  agentName?: AgentName,
): string {
  const identity = agentName ?? agentNameFromWindowName(windowName);
  if (identity === undefined) return windowName;

  const label = stripAgentTitleGlyphs(paneTitle ?? '');
  return label || identity;
}

export function agentNameFromWindowName(windowName: string): AgentName | undefined {
  if (AGENT_NAMES.has(windowName)) return windowName as AgentName;
  return undefined;
}

export function stripAgentTitleGlyphs(title: string): string {
  return title.replace(LEADING_AGENT_TITLE_GLYPHS, '').trim();
}

export function resolveTerminalTooltip(worktreePath: string, sessionName: string): string {
  const term = terminalSessionNumber(worktreePath, sessionName);
  return term > 0 ? `term-${term}` : sessionName;
}
