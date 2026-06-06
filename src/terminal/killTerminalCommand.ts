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
  ) {}

  async run(node: TerminalNodeLike | undefined): Promise<void> {
    if (!node) return;

    await this.tmux.killSession(node.terminal.sessionName);
    this.refresh();
  }
}
