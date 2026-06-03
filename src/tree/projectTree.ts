import * as vscode from 'vscode';
import { listWorktrees, Worktree } from '../git/worktrees';

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
    const path = picked[0].fsPath;
    const cfg = vscode.workspace.getConfiguration('deck');
    const projects = cfg.get<string[]>('projects', []);
    if (!projects.includes(path)) {
      await cfg.update('projects', [...projects, path], vscode.ConfigurationTarget.Global);
    }
    this.refresh();
  }
}
