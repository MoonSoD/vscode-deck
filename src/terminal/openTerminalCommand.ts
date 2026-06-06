import * as path from 'node:path';
import * as vscode from 'vscode';
import { awaitProcessId } from './awaitProcessId';
import { sessionNameForTerminal } from './editorTerminalHydrator';
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

interface TerminalPidStoreLike {
  set(sessionName: string, pid: number): Promise<void>;
}

interface OpenTerminalCommandOptions {
  pendingTerminalOpens?: PendingTerminalOpenStoreLike;
  switcher?: WorktreeSwitcherLike;
  pidStore?: TerminalPidStoreLike;
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

    const existing =
      this.registry.getTerminal(node.terminal.sessionName) ??
      this.findRestoredTerminal(node.terminal.sessionName);
    if (existing) {
      this.registry.set(node.terminal.sessionName, existing);
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
    const pid = await awaitProcessId(terminal);
    if (pid !== undefined) await this.options.pidStore?.set(node.terminal.sessionName, pid);
    terminal.show(false);
  }

  // Defensive: hydration at activate registers restored Deck tabs, but the
  // event ordering is not strictly synchronous (`onDidOpenTerminal` may fire
  // after activate returns, and a slow `processId` resolution can land in
  // the wrong PID branch). If a click arrives before the registry caught up,
  // scan `vscode.window.terminals` directly via the same name+cwd matcher
  // the hydrator uses — finds the restored tab even if the registry missed.
  private findRestoredTerminal(sessionName: string): vscode.Terminal | undefined {
    for (const candidate of vscode.window.terminals) {
      if (sessionNameForTerminal(candidate) === sessionName) return candidate;
    }
    return undefined;
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
