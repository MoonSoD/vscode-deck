import * as path from 'node:path';
import * as vscode from 'vscode';
import { getCommonDir } from '../git/worktrees';
import { WorkspaceRoot, WorkspaceRootPlanner } from './workspaceRootPlanner';

const ACTIVE_WORKTREES_KEY = 'deck.activeWorktrees';

export class WorktreeSwitcher {
  constructor(private readonly globalState: vscode.Memento) {}

  async switchTo(targetPath: string): Promise<void> {
    const currentFolders = vscode.workspace.workspaceFolders ?? [];
    const currentRoots = await this.resolveRoots(currentFolders);
    const target = {
      path: targetPath,
      commonDir: await getCommonDir(targetPath),
    };
    const planned = WorkspaceRootPlanner.planSwap(currentRoots, target);
    if (planned === currentRoots) return;

    if (vscode.workspace.getConfiguration('deck').get<boolean>('autoSaveOnSwitch', true)) {
      await vscode.workspace.saveAll(false);
    }

    await this.saveActiveWorktree(target);

    vscode.workspace.updateWorkspaceFolders(
      0,
      currentFolders.length,
      ...planned.map((root) => ({
        uri: vscode.Uri.file(root.path),
        name: root.name ?? path.basename(root.path),
      })),
    );
  }

  private async resolveRoots(folders: readonly vscode.WorkspaceFolder[]): Promise<WorkspaceRoot[]> {
    return Promise.all(
      folders.map(async (folder) => ({
        path: folder.uri.fsPath,
        name: folder.name,
        commonDir: await getCommonDir(folder.uri.fsPath),
      })),
    );
  }

  private async saveActiveWorktree(target: WorkspaceRoot): Promise<void> {
    const active = this.globalState.get<Record<string, string>>(ACTIVE_WORKTREES_KEY, {});
    await this.globalState.update(ACTIVE_WORKTREES_KEY, {
      ...active,
      [target.commonDir]: target.path,
    });
  }
}
