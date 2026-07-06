import type { TmuxSession } from './tmuxCli';
import { terminalSessionNumber } from './tmuxSafe';
import type { AgentName } from '../agent/agentTypes';

export interface CachedTerminalSession {
  sessionName: string;
  n: number;
  windowName: string;
  paneTitle?: string;
  agentName?: AgentName;
}

export function toCachedTerminalSessions(
  worktreePath: string,
  sessions: readonly TmuxSession[],
): CachedTerminalSession[] {
  return sessions
    .map((session) => ({
      sessionName: session.sessionName,
      n: terminalSessionNumber(worktreePath, session.sessionName),
      windowName: session.windowName,
      paneTitle: session.paneTitle,
      agentName: session.agentName,
    }))
    .filter((session) => session.n > 0)
    .sort((left, right) => left.n - right.n);
}
