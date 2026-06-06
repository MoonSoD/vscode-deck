import type { TerminalSessionListCacheStore } from './terminalSessionListCacheStore';
import type { TerminalSessionRegistry } from './terminalSessionRegistry';

export interface CloseTerminalTmuxCli {
  killSession(session: string): Promise<void>;
}

interface TerminalNodeLike {
  terminal: {
    sessionName: string;
  };
}

interface TerminalPidStoreLike {
  remove(sessionName: string): Promise<void>;
}

export class CloseTerminalCommand {
  constructor(
    private readonly tmux: CloseTerminalTmuxCli,
    private readonly registry: Pick<TerminalSessionRegistry, 'getTerminal' | 'deleteSession'>,
    private readonly refresh: () => void = () => undefined,
    private readonly terminalSessionListCache: Pick<TerminalSessionListCacheStore, 'removeSession'> = {
      removeSession: async () => undefined,
    },
    private readonly pidStore?: TerminalPidStoreLike,
  ) {}

  async run(node: TerminalNodeLike | undefined): Promise<void> {
    if (!node) return;

    const session = node.terminal.sessionName;
    await this.tmux.killSession(session);
    await this.terminalSessionListCache.removeSession(session);
    await this.pidStore?.remove(session);
    const terminal = this.registry.getTerminal(session);
    this.registry.deleteSession(session);
    terminal?.dispose?.();
    this.refresh();
  }
}

export type KillTerminalTmuxCli = CloseTerminalTmuxCli;
export { CloseTerminalCommand as KillTerminalCommand };
