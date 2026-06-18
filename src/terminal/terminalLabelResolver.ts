import { terminalSessionNumber } from './tmuxSafe';

const AGENT_NAMES = new Set(['claude', 'codex']);
const LEADING_AGENT_TITLE_GLYPHS = /^[\u2800-\u28ff\u2700-\u27bf\s]+/u;

export function resolveTerminalLabel(windowName: string, paneTitle?: string): string {
  if (!AGENT_NAMES.has(windowName)) return windowName;

  const label = stripAgentTitleGlyphs(paneTitle ?? '');
  return label || windowName;
}

export function stripAgentTitleGlyphs(title: string): string {
  return title.replace(LEADING_AGENT_TITLE_GLYPHS, '').trim();
}

export function resolveTerminalTooltip(worktreePath: string, sessionName: string): string {
  const term = terminalSessionNumber(worktreePath, sessionName);
  return term > 0 ? `term-${term}` : sessionName;
}
