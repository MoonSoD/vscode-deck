import * as vscode from 'vscode';
import { getCommonDir, getCommonDirSafe, listWorktrees, Worktree } from '../git/worktrees';
import { ActiveWorktreeStore } from '../switch/activeWorktreeStore';
import { describeProjectTreeItem, describeWorktreeTreeItem } from './worktreeTreeItem';

type Node = ProjectNode | WorktreeNode;

class ProjectNode extends vscode.TreeItem {
  constructor(public readonly projectPath: string, isActiveProject: boolean) {
    const item = describeProjectTreeItem(projectPath, isActiveProject);
    super(item.label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'deck.project';
    this.description = item.description;
    this.tooltip = projectPath;
    this.iconPath = new vscode.ThemeIcon(item.iconId);
  }
}

class WorktreeNode extends vscode.TreeItem {
  constructor(public readonly worktree: Worktree, activeWorktreePath: string | undefined) {
    const item = describeWorktreeTreeItem(worktree, activeWorktreePath);
    super(item.label);
    this.contextValue = item.contextValue;
    this.description = item.description;
    this.iconPath = new vscode.ThemeIcon(item.iconId);
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
  private activeProjectCommonDir: string | null = null;
  private resolvingActiveProject = false;
  private readonly projectCommonDirs = new Map<string, string | null>();
  private readonly resolvingProjectPaths = new Set<string>();

  constructor(private readonly activeWorktrees: ActiveWorktreeStore) {}

  refresh(): void {
    this.resolveActiveProject();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  getChildren(element?: Node): vscode.ProviderResult<Node[]> {
    if (!element) {
      // Sync return: any `await` here would yield to the event loop and let
      // viewsWelcome ("No projects yet") flash on every tree.refresh().
      const projects = vscode.workspace
        .getConfiguration('deck')
        .get<string[]>('projects', []);
      this.resolveActiveProject();
      return projects.map((p) => {
        this.resolveProjectCommonDir(p);
        const projectCommonDir = this.projectCommonDirs.get(p);
        return new ProjectNode(
          p,
          projectCommonDir !== undefined &&
            projectCommonDir !== null &&
            projectCommonDir === this.activeProjectCommonDir,
        );
      });
    }
    if (element instanceof ProjectNode) {
      return this.getWorktreeChildren(element);
    }
    return [];
  }

  private async getWorktreeChildren(element: ProjectNode): Promise<Node[]> {
    const activeWorktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const worktrees = await listWorktrees(element.projectPath);
    return worktrees.map((w) => new WorktreeNode(w, activeWorktreePath));
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
    const commonDir = await getCommonDirSafe(seedPath);
    if (commonDir === null) {
      vscode.window.showErrorMessage(
        `Cannot add ${seedPath}: not a git repository.`,
      );
      return;
    }
    const cfg = vscode.workspace.getConfiguration('deck');
    const projects = cfg.get<string[]>('projects', []);
    const isRegistered = await this.hasRegisteredCommonDir(projects, commonDir);

    if (!isRegistered) {
      await cfg.update('projects', [...projects, seedPath], vscode.ConfigurationTarget.Global);
      this.projectCommonDirs.set(seedPath, commonDir);
    }

    await this.activeWorktrees.set(commonDir, seedPath);
    await this.activeWorktrees.setFocusIntent(true);
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(seedPath), {
      forceNewWindow: false,
    });
  }

  private async hasRegisteredCommonDir(projects: string[], commonDir: string): Promise<boolean> {
    // getCommonDirSafe: a stale registered entry returns null and is skipped,
    // so dedup never throws and a single bad entry doesn't block Add Project.
    for (const projectPath of projects) {
      const registered = await getCommonDirSafe(projectPath);
      if (registered !== null && registered === commonDir) return true;
    }
    return false;
  }

  private resolveActiveProject(): void {
    if (this.resolvingActiveProject) return;
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.setActiveProjectCommonDir(null);
      return;
    }

    this.resolvingActiveProject = true;
    void getCommonDirSafe(folder.uri.fsPath)
      .then((commonDir) => this.setActiveProjectCommonDir(commonDir))
      .finally(() => {
        this.resolvingActiveProject = false;
      });
  }

  private resolveProjectCommonDir(projectPath: string): void {
    if (this.projectCommonDirs.has(projectPath) || this.resolvingProjectPaths.has(projectPath)) {
      return;
    }

    this.resolvingProjectPaths.add(projectPath);
    void getCommonDir(projectPath)
      .then((commonDir) => {
        this.projectCommonDirs.set(projectPath, commonDir);
        this._onDidChangeTreeData.fire(undefined);
      })
      .catch(() => {
        this.projectCommonDirs.set(projectPath, null);
        this._onDidChangeTreeData.fire(undefined);
      })
      .finally(() => {
        this.resolvingProjectPaths.delete(projectPath);
      });
  }

  private setActiveProjectCommonDir(commonDir: string | null): void {
    if (this.activeProjectCommonDir === commonDir) return;
    this.activeProjectCommonDir = commonDir;
    this._onDidChangeTreeData.fire(undefined);
  }
}
