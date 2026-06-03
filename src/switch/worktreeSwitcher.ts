import * as path from 'node:path';
import * as vscode from 'vscode';
import { getCommonDir } from '../git/worktrees';
import { ActiveWorktreeStore } from './activeWorktreeStore';
import { WorkspaceRoot, WorkspaceRootPlanner } from './workspaceRootPlanner';

export class WorktreeSwitcher {
  constructor(private readonly activeWorktrees: ActiveWorktreeStore) {}

  async switchTo(targetPath: string): Promise<void> {
    const currentFolders = vscode.workspace.workspaceFolders ?? [];
    const currentRoots = await this.resolveRoots(currentFolders);
    const targetRoot: WorkspaceRoot = {
      path: targetPath,
      commonDir: await getCommonDir(targetPath),
    };
    const plannedRoots = WorkspaceRootPlanner.planSwap(currentRoots, targetRoot);
    if (plannedRoots === currentRoots) return;

    if (vscode.workspace.getConfiguration('deck').get<boolean>('autoSaveOnSwitch', true)) {
      await vscode.workspace.saveAll(false);
    }

    await this.activeWorktrees.set(targetRoot.commonDir, targetRoot.path);

    vscode.workspace.updateWorkspaceFolders(
      0,
      currentFolders.length,
      ...plannedRoots.map((root) => ({
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
}
