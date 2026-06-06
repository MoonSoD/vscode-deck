import * as vscode from 'vscode';
import { terminalSessionName } from './tmuxSafe';

export interface AddTerminalTmuxCli {
  ensureSessionWindow(session: string, windowName: string, cwd: string): Promise<void>;
  attachShellArgs(session: string): string[];
}

interface WorktreeNodeLike {
  worktree: {
    path: string;
  };
}

export class AddTerminalCommand {
  constructor(private readonly tmux: AddTerminalTmuxCli) {}

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    const termN = 1;
    const windowName = `term-${termN}`;
    const session = terminalSessionName(node.worktree.path, termN);
    await this.tmux.ensureSessionWindow(session, windowName, node.worktree.path);

    const terminal = vscode.window.createTerminal({
      name: `Deck ${windowName}`,
      shellPath: 'tmux',
      shellArgs: this.tmux.attachShellArgs(session),
      location: { viewColumn: vscode.ViewColumn.Active },
    });
    terminal.show(true);
  }
}
