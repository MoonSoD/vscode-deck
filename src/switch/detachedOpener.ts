import * as vscode from 'vscode';
import { ActiveWorktreeStore } from './activeWorktreeStore';

export class DetachedOpener {
  constructor(private readonly activeWorktrees: ActiveWorktreeStore) {}

  async open(worktreePath: string): Promise<void> {
    await this.activeWorktrees.setFocusIntent(true);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(worktreePath), {
      forceNewWindow: true,
    });
  }
}
