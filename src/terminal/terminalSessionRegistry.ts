import * as vscode from 'vscode';

export interface TerminalLike {
  show(preserveFocus?: boolean): void;
  dispose?(): void;
}

export class TerminalSessionRegistry {
  private readonly terminals = new Map<string, TerminalLike>();

  get(session: string): TerminalLike | undefined {
    return this.terminals.get(session);
  }

  getTerminal(session: string): TerminalLike | undefined {
    return this.terminals.get(session);
  }

  set(session: string, terminal: TerminalLike): void {
    this.terminals.set(session, terminal);
  }

  deleteSession(session: string): void {
    this.terminals.delete(session);
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
    // Registered as a VS Code subscription; no external resources to release.
  }
}
