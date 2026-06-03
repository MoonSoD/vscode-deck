import * as path from 'node:path';
import * as vscode from 'vscode';
import { getCommonDir } from '../git/worktrees';
import { ActiveWorktreeStore } from './activeWorktreeStore';
import { WorkspaceRoot, WorkspaceRootPlanner } from './workspaceRootPlanner';

export class MountReconciler {
  constructor(private readonly activeWorktrees: ActiveWorktreeStore) {}

  async reconcile(): Promise<void> {
    const projectPaths = vscode.workspace
      .getConfiguration('deck')
      .get<string[]>('projects', []);
    if (projectPaths.length === 0) return;

    const currentFolders = vscode.workspace.workspaceFolders ?? [];
    const currentRoots = await this.resolveRoots(currentFolders);
    const registryRoots = await this.resolveRegistry(projectPaths);
    const plannedRoots = WorkspaceRootPlanner.planReconcile(currentRoots, registryRoots);
    if (plannedRoots === currentRoots) return;

    const rootsToAppend = plannedRoots.slice(currentRoots.length);
    vscode.workspace.updateWorkspaceFolders(
      currentFolders.length,
      0,
      ...rootsToAppend.map((root) => ({
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

  private async resolveRegistry(projectPaths: string[]): Promise<WorkspaceRoot[]> {
    return Promise.all(
      projectPaths.map(async (projectPath) => {
        const commonDir = await getCommonDir(projectPath);
        return {
          path: this.activeWorktrees.get(commonDir) ?? projectPath,
          commonDir,
        };
      }),
    );
  }
}
