import * as vscode from 'vscode';

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

  findSession(terminal: TerminalLike): string | undefined {
    for (const [session, registered] of this.terminals) {
      if (registered === terminal) return session;
    }
    return undefined;
  }

  async renameIfActive(session: string, name: string): Promise<void> {
    const terminal = this.terminals.get(session);
    if (!terminal) return;
    if (vscode.window.activeTerminal !== (terminal as unknown as vscode.Terminal)) return;
    try {
      await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name });
    } catch {
      // Internal VS Code command — cosmetic, swallow if it ever disappears.
    }
  }

  dispose(): void {
    this.closeDisposable?.dispose();
  }
}
