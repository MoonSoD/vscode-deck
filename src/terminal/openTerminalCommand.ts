import * as path from 'node:path';
import * as vscode from 'vscode';
import { TerminalSessionRegistry } from './terminalSessionRegistry';

export interface OpenTerminalTmuxCli {
  attachShellArgs(session: string): string[];
}

interface TerminalNodeLike {
  terminal: {
    sessionName: string;
    windowName: string;
  };
  n: number;
  worktreePath?: string;
}

interface PendingTerminalOpenStoreLike {
  set(worktreePath: string, sessionName: string): Promise<void>;
}

interface WorktreeSwitcherLike {
  switchTo(worktreePath: string): Promise<void>;
}

interface OpenTerminalCommandOptions {
  pendingTerminalOpens?: PendingTerminalOpenStoreLike;
  switcher?: WorktreeSwitcherLike;
}

export class OpenTerminalCommand {
  constructor(
    private readonly tmux: OpenTerminalTmuxCli,
    private readonly registry: TerminalSessionRegistry,
    private readonly options: OpenTerminalCommandOptions = {},
  ) {}

  async run(node: TerminalNodeLike | undefined): Promise<void> {
    if (!node) return;
    if (await this.switchForForeignWorktree(node)) return;

    const existing = this.registry.getTerminal(node.terminal.sessionName);
    if (existing) {
      // VS Code: Terminal.show(preserveFocus). false → focus moves to the terminal.
      existing.show(false);
      return;
    }

    // Mirror sidebar's `<n> <command>` — see AddTerminalCommand.
    const terminal = vscode.window.createTerminal({
      name: `${node.n} ${node.terminal.windowName}`,
      shellPath: 'tmux',
      shellArgs: this.tmux.attachShellArgs(node.terminal.sessionName),
      location: { viewColumn: vscode.ViewColumn.Active },
    });
    this.registry.set(node.terminal.sessionName, terminal);
    terminal.show(false);
  }

  private async switchForForeignWorktree(node: TerminalNodeLike): Promise<boolean> {
    const currentWorktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!currentWorktreePath || !node.worktreePath) return false;
    // Normalize so a trailing slash on one side doesn't trigger a spurious switch.
    if (path.resolve(node.worktreePath) === path.resolve(currentWorktreePath)) return false;
    if (!this.options.pendingTerminalOpens || !this.options.switcher) return false;

    await this.options.pendingTerminalOpens.set(node.worktreePath, node.terminal.sessionName);
    await this.options.switcher.switchTo(node.worktreePath);
    return true;
  }
}
