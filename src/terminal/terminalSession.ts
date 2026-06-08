import type { TmuxSession } from './tmuxCli';
import { terminalSessionNumber } from './tmuxSafe';

export interface CachedTerminalSession {
  sessionName: string;
  n: number;
  windowName: string;
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
    }))
    .filter((session) => session.n > 0)
    .sort((left, right) => left.n - right.n);
}
