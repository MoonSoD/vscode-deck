import * as path from 'node:path';
import * as vscode from 'vscode';
import { addProjectMount } from '../projects/addProjectMount';
import { getCommonDir, listWorktrees, Worktree } from '../git/worktrees';
import { ActiveWorktreeStore } from '../switch/activeWorktreeStore';
import { resolveWorkspaceRoots } from '../switch/resolveWorkspaceRoots';
import { WorkspaceRoot } from '../switch/workspaceRootPlanner';

type Node = ProjectNode | WorktreeNode;

class ProjectNode extends vscode.TreeItem {
  constructor(public readonly projectPath: string) {
    super(projectPath.split('/').pop() ?? projectPath, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'project';
    this.tooltip = projectPath;
    this.iconPath = new vscode.ThemeIcon('repo');
  }
}

class WorktreeNode extends vscode.TreeItem {
  constructor(public readonly worktree: Worktree) {
    super(worktree.branch ?? worktree.path);
    this.contextValue = 'worktree';
    this.description = worktree.path;
    this.iconPath = new vscode.ThemeIcon('git-branch');
    this.command = {
      command: 'deck.switchWorktree',
      title: 'Switch',
      arguments: [worktree.path],
    };
  }
}

export class ProjectTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private readonly activeWorktrees: ActiveWorktreeStore) {}

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: Node): Promise<Node[]> {
    if (!element) {
      const projects = vscode.workspace
        .getConfiguration('deck')
        .get<string[]>('projects', []);
      return projects.map((p) => new ProjectNode(p));
    }
    if (element instanceof ProjectNode) {
      const worktrees = await listWorktrees(element.projectPath);
      return worktrees.map((w) => new WorktreeNode(w));
    }
    return [];
  }

  async addProject(): Promise<void> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Add as Deck project',
    });
    if (!picked || picked.length === 0) return;
    const seedPath = picked[0].fsPath;
    const cfg = vscode.workspace.getConfiguration('deck');
    await addProjectMount(seedPath, {
      listProjects: () => cfg.get<string[]>('projects', []),
      updateProjects: (projects) =>
        cfg.update('projects', [...projects], vscode.ConfigurationTarget.Global),
      getCommonDir,
      getCurrentRoots: () =>
        resolveWorkspaceRoots(
          (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
            path: folder.uri.fsPath,
            name: folder.name,
          })),
        ),
      appendWorkspaceRoots: (roots) => this.appendWorkspaceRoots(roots),
      setActiveWorktree: (commonDir, worktreePath) =>
        this.activeWorktrees.set(commonDir, worktreePath),
    });
    this.refresh();
  }

  private appendWorkspaceRoots(roots: WorkspaceRoot[]): void {
    const currentFolders = vscode.workspace.workspaceFolders ?? [];
    vscode.workspace.updateWorkspaceFolders(
      currentFolders.length,
      0,
      ...roots.map((root) => ({
        uri: vscode.Uri.file(root.path),
        name: root.name ?? path.basename(root.path),
      })),
    );
  }
}
