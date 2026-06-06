import type { TerminalSessionListCacheStore } from './terminalSessionListCacheStore';
import type { TerminalSessionRegistry } from './terminalSessionRegistry';

export interface KillTerminalTmuxCli {
  killSession(session: string): Promise<void>;
}

interface TerminalNodeLike {
  terminal: {
    sessionName: string;
  };
}

export class CloseTerminalCommand {
  constructor(
    private readonly tmux: KillTerminalTmuxCli,
    private readonly registry: Pick<TerminalSessionRegistry, 'getTerminal' | 'deleteSession'>,
    private readonly refresh: () => void = () => undefined,
    private readonly terminalSessionListCache: Pick<TerminalSessionListCacheStore, 'removeSession'> = {
      removeSession: async () => undefined,
    },
  ) {}

  async run(node: TerminalNodeLike | undefined): Promise<void> {
    if (!node) return;

    const session = node.terminal.sessionName;
    await this.tmux.killSession(session);
    await this.terminalSessionListCache.removeSession(session);
    const terminal = this.registry.getTerminal(session);
    this.registry.deleteSession(session);
    terminal?.dispose?.();
    this.refresh();
  }
}

export { CloseTerminalCommand as KillTerminalCommand };
