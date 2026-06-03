import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { getCommonDir, listWorktrees } from '../git/worktrees';
import { ActiveWorktreeStore } from './activeWorktreeStore';
import {
  RecoverableWorkspaceRoot,
  RecoveryProject,
  WorkspaceRoot,
  WorkspaceRootPlanner,
} from './workspaceRootPlanner';

export class MountReconciler {
  constructor(private readonly activeWorktrees: ActiveWorktreeStore) {}

  async reconcile(): Promise<void> {
    const projectPaths = vscode.workspace
      .getConfiguration('deck')
      .get<string[]>('projects', []);
    if (projectPaths.length === 0) return;

    const currentFolders = vscode.workspace.workspaceFolders ?? [];
    const registryProjects = await this.resolveRegistry(projectPaths);
    const currentRoots = await this.resolveRoots(currentFolders, registryProjects);
    const recovery = WorkspaceRootPlanner.planRecovery(currentRoots, registryProjects);

    for (const recovered of [...recovery.recovered].sort((a, b) => b.index - a.index)) {
      const recoveryRoot = recovery.roots[recovered.index];
      await this.activeWorktrees.set(recovered.commonDir, recovered.recoveryPath);
      vscode.workspace.updateWorkspaceFolders(recovered.index, 1, {
        uri: vscode.Uri.file(recoveryRoot.path),
        name: recoveryRoot.name ?? path.basename(recoveryRoot.path),
      });
    }

    if (recovery.recovered.length > 0) {
      vscode.window.showWarningMessage(
        `Deck recovered ${recovery.recovered.length} deleted worktree root(s) to their main worktree.`,
      );
    }

    if (recovery.unrecoverable.length > 0) {
      vscode.window.showWarningMessage(
        `Deck could not recover ${recovery.unrecoverable.length} deleted worktree root(s); no surviving worktrees were found.`,
      );
    }

    const registryRoots = registryProjects
      .map((project) => project.activeRoot)
      .filter((root): root is WorkspaceRoot => root !== undefined);
    const currentWorkspaceRoots = recovery.roots;
    const plannedRoots = WorkspaceRootPlanner.planReconcile(currentWorkspaceRoots, registryRoots);
    if (plannedRoots === currentWorkspaceRoots) return;

    const rootsToAppend = plannedRoots.slice(currentWorkspaceRoots.length);
    vscode.workspace.updateWorkspaceFolders(
      currentFolders.length,
      0,
      ...rootsToAppend.map((root) => ({
        uri: vscode.Uri.file(root.path),
        name: root.name ?? path.basename(root.path),
      })),
    );
  }

  private async resolveRoots(
    folders: readonly vscode.WorkspaceFolder[],
    registryProjects: readonly RegistryProject[],
  ): Promise<RecoverableWorkspaceRoot[]> {
    return Promise.all(
      folders.map(async (folder) => {
        const folderPath = folder.uri.fsPath;
        const exists = existsSync(folderPath);
        const project = registryProjects.find((candidate) => candidate.activePath === folderPath);
        return {
          path: folderPath,
          name: folder.name,
          commonDir: project?.commonDir ?? (exists ? await getCommonDir(folderPath) : folderPath),
          exists,
        };
      }),
    );
  }

  private async resolveRegistry(projectPaths: string[]): Promise<RegistryProject[]> {
    const projects: RegistryProject[] = [];

    for (const projectPath of projectPaths) {
      try {
        const commonDir = await getCommonDir(projectPath);
        const activePath = this.activeWorktrees.get(commonDir) ?? projectPath;
        const worktrees = await listWorktrees(projectPath);
        const mainWorktree = worktrees[0];
        const mainRoot = mainWorktree ? { path: mainWorktree.path, commonDir } : undefined;
        const activeRoot =
          existsSync(activePath) || !mainRoot ? { path: activePath, commonDir } : mainRoot;

        projects.push({
          commonDir,
          activePath,
          activeRoot,
          mainRoot,
        });
      } catch {
        vscode.window.showWarningMessage(
          `Deck could not scan registered project ${projectPath}; no surviving worktrees were found.`,
        );
      }
    }

    return projects;
  }
}

interface RegistryProject extends RecoveryProject {
  activePath: string;
  activeRoot?: WorkspaceRoot;
}
