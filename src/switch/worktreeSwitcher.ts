import * as vscode from 'vscode';
import { getCommonDir } from '../git/worktrees';
import { ActiveWorktreeStore } from './activeWorktreeStore';

export class WorktreeSwitcher {
  constructor(private readonly activeWorktrees: ActiveWorktreeStore) {}

  async switchTo(targetPath: string): Promise<void> {
    const commonDir = await getCommonDir(targetPath);
    await this.activeWorktrees.set(commonDir, targetPath);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetPath), {
      forceNewWindow: false,
    });
  }
}
