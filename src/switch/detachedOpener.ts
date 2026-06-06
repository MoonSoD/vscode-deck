import * as vscode from 'vscode';

export class DetachedOpener {
  async open(worktreePath: string): Promise<void> {
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), {
      forceNewWindow: true,
    });
  }
}
