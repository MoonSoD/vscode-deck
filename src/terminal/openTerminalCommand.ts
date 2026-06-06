import * as vscode from 'vscode';
import { TerminalSessionRegistry } from './terminalSessionRegistry';
import { describeTerminalTreeItem } from '../tree/worktreeTreeItem';

export interface OpenTerminalTmuxCli {
  attachShellArgs(session: string): string[];
}

interface TerminalNodeLike {
  terminal: {
    sessionName: string;
    windowName: string;
  };
  n: number;
}

export class OpenTerminalCommand {
  constructor(
    private readonly tmux: OpenTerminalTmuxCli,
    private readonly registry: TerminalSessionRegistry,
  ) {}

  async run(node: TerminalNodeLike | undefined): Promise<void> {
    if (!node) return;

    const existing = this.registry.get(node.terminal.sessionName);
    if (existing) {
      // VS Code: Terminal.show(preserveFocus). false → focus moves to the terminal.
      existing.show(false);
      return;
    }

    // Tab name mirrors the sidebar row label exactly — see AddTerminalCommand
    // for staleness caveat.
    const terminal = vscode.window.createTerminal({
      name: describeTerminalTreeItem(node.n, node.terminal.windowName).label,
      shellPath: 'tmux',
      shellArgs: this.tmux.attachShellArgs(node.terminal.sessionName),
      location: { viewColumn: vscode.ViewColumn.Active },
    });
    this.registry.set(node.terminal.sessionName, terminal);
    terminal.show(false);
  }
}
