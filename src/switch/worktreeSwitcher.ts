import * as vscode from 'vscode';
import { getCommonDir } from '../git/worktrees';
import { ActiveWorktreeStore } from './activeWorktreeStore';

interface TabSnapshotCaptureStore {
  capture(): Promise<void>;
}

export class WorktreeSwitcher {
  constructor(
    private readonly activeWorktrees: ActiveWorktreeStore,
    private readonly tabSnapshots: TabSnapshotCaptureStore = { capture: async () => undefined },
  ) {}

  async switchTo(targetPath: string): Promise<void> {
    const commonDir = await getCommonDir(targetPath);
    await this.activeWorktrees.set(commonDir, targetPath);
    await this.tabSnapshots.capture();
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(targetPath), {
      forceNewWindow: false,
    });
  }
}
