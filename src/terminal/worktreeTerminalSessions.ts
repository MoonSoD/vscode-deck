import type { TmuxSession } from './tmuxCli';
import { type CachedTerminalSession, toCachedTerminalSessions } from './terminalSession';

export function groupTerminalSessionsByWorktree(
  worktreePaths: readonly string[],
  sessions: readonly TmuxSession[],
): Map<string, CachedTerminalSession[]> {
  return new Map(
    worktreePaths.map((worktreePath) => [
      worktreePath,
      toCachedTerminalSessions(worktreePath, sessions),
    ]),
  );
}
