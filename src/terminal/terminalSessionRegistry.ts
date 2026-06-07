import * as vscode from 'vscode';

export interface TerminalLike {
  show(preserveFocus?: boolean): void;
  dispose?(): void;
}

export class TerminalSessionRegistry {
  private readonly terminals = new Map<string, TerminalLike>();

  get(session: string): TerminalLike | undefined {
    return this.getTerminal(session);
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
    // Skip the no-op rename. During Cmd+Q restoration VS Code sequentially
    // activates each restored tab to wire up its renderer, firing
    // onDidChangeActiveTerminal for each one. If the saved name already
    // matches the target format, firing renameWithArg adds command-bus
    // traffic and visual label re-renders for no gain.
    if ((terminal as unknown as vscode.Terminal).name === name) return;
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
