import * as path from 'node:path';
import * as vscode from 'vscode';
import { getCommonDirSafe } from '../git/worktrees';
import { ActiveWorktreeStore } from './activeWorktreeStore';
import { resolveWorkspaceRoots } from './resolveWorkspaceRoots';
import { WorkspaceRoot, WorkspaceRootPlanner } from './workspaceRootPlanner';

export class WorktreeSwitcher {
  constructor(private readonly activeWorktrees: ActiveWorktreeStore) {}

  async switchTo(targetPath: string): Promise<void> {
    const commonDir = await getCommonDirSafe(targetPath);
    if (commonDir === null) return;

    const currentFolders = vscode.workspace.workspaceFolders ?? [];
    const currentRoots = await resolveWorkspaceRoots(
      currentFolders.map((folder) => ({ path: folder.uri.fsPath, name: folder.name })),
    );
    const targetRoot: WorkspaceRoot = { path: targetPath, commonDir };
    const plannedRoots = WorkspaceRootPlanner.planSwap(currentRoots, targetRoot);
    if (plannedRoots === currentRoots) return;

    if (vscode.workspace.getConfiguration('deck').get<boolean>('autoSaveOnSwitch', true)) {
      await vscode.workspace.saveAll(false);
    }

    await this.activeWorktrees.set(commonDir, targetPath);

    vscode.workspace.updateWorkspaceFolders(
      0,
      currentFolders.length,
      ...plannedRoots.map((root) => ({
        uri: vscode.Uri.file(root.path),
        name: root.name ?? path.basename(root.path),
      })),
    );
  }
}
