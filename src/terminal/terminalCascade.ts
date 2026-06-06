import { terminalSessionPrefix } from './tmuxSafe';

interface TmuxLike {
  listSessions(): Promise<Array<{ sessionName: string }>>;
  killSession(session: string): Promise<void>;
}

export class TerminalCascade {
  constructor(private readonly tmux: TmuxLike) {}

  async killWorktree(worktreePath: string): Promise<void> {
    const prefix = terminalSessionPrefix(worktreePath);
    const sessions = await this.tmux.listSessions();

    for (const session of sessions) {
      if (!session.sessionName.startsWith(prefix)) continue;
      try {
        await this.tmux.killSession(session.sessionName);
      } catch {
        // Cascade cleanup is best-effort; removal must still proceed.
      }
    }
  }
}
