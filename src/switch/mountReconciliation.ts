import * as path from 'node:path';
import * as vscode from 'vscode';
import { getCommonDirSafe } from '../git/worktrees';
import { ActiveWorktreeStore } from './activeWorktreeStore';
import { resolveWorkspaceRoots } from './resolveWorkspaceRoots';
import { WorkspaceRoot, WorkspaceRootPlanner } from './workspaceRootPlanner';

export class MountReconciler {
  constructor(private readonly activeWorktrees: ActiveWorktreeStore) {}

  async reconcile(): Promise<void> {
    const projectPaths = vscode.workspace
      .getConfiguration('deck')
      .get<string[]>('projects', []);
    if (projectPaths.length === 0) return;

    const currentFolders = vscode.workspace.workspaceFolders ?? [];
    const currentRoots = await resolveWorkspaceRoots(
      currentFolders.map((folder) => ({ path: folder.uri.fsPath, name: folder.name })),
    );
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

  private async resolveRegistry(projectPaths: string[]): Promise<WorkspaceRoot[]> {
    const resolved = await Promise.all(
      projectPaths.map(async (projectPath): Promise<WorkspaceRoot | null> => {
        const commonDir = await getCommonDirSafe(projectPath);
        if (commonDir === null) return null;
        return {
          path: this.activeWorktrees.get(commonDir) ?? projectPath,
          commonDir,
        };
      }),
    );
    // Skip registered projects whose repo can't be resolved (deleted/moved);
    // graceful handling lives in Recovery (#6), here we just don't crash.
    return resolved.filter((root): root is WorkspaceRoot => root !== null);
  }
}
