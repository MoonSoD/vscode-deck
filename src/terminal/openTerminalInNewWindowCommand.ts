import * as vscode from 'vscode';

interface TerminalNodeLike {
  terminal: {
    sessionName: string;
  };
  worktreePath?: string;
}

interface PendingTerminalOpenStoreLike {
  set(worktreePath: string, sessionName: string): Promise<void>;
}

export class OpenTerminalInNewWindowCommand {
  constructor(private readonly pendingTerminalOpens: PendingTerminalOpenStoreLike) {}

  async run(node: TerminalNodeLike | undefined): Promise<void> {
    if (!node?.worktreePath) return;

    await this.pendingTerminalOpens.set(node.worktreePath, node.terminal.sessionName);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(node.worktreePath), {
      forceNewWindow: true,
    });
  }
}
