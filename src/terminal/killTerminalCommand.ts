import type { TerminalSessionListCacheStore } from './terminalSessionListCacheStore';

export interface KillTerminalTmuxCli {
  killSession(session: string): Promise<void>;
}

interface TerminalNodeLike {
  terminal: {
    sessionName: string;
  };
}

export class KillTerminalCommand {
  constructor(
    private readonly tmux: KillTerminalTmuxCli,
    private readonly refresh: () => void = () => undefined,
    private readonly terminalSessionListCache: Pick<TerminalSessionListCacheStore, 'removeSession'> = {
      removeSession: async () => undefined,
    },
  ) {}

  async run(node: TerminalNodeLike | undefined): Promise<void> {
    if (!node) return;

    await this.tmux.killSession(node.terminal.sessionName);
    await this.terminalSessionListCache.removeSession(node.terminal.sessionName);
    this.refresh();
  }
}
