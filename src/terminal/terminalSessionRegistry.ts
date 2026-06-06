export interface TerminalLike {
  show(preserveFocus?: boolean): void;
}

interface DisposableLike {
  dispose(): void;
}

type CloseTerminalEvent = (listener: (terminal: TerminalLike) => void) => DisposableLike;

export class TerminalSessionRegistry {
  private readonly terminals = new Map<string, TerminalLike>();
  private readonly closeDisposable?: DisposableLike;

  constructor(onDidCloseTerminal?: CloseTerminalEvent) {
    this.closeDisposable = onDidCloseTerminal?.((terminal) => {
      for (const [session, registered] of this.terminals) {
        if (registered === terminal) this.terminals.delete(session);
      }
    });
  }

  get(session: string): TerminalLike | undefined {
    return this.terminals.get(session);
  }

  set(session: string, terminal: TerminalLike): void {
    this.terminals.set(session, terminal);
  }

  dispose(): void {
    this.closeDisposable?.dispose();
  }
}
