import * as vscode from 'vscode';
import { getCommonDir, getCommonDirSafe, listWorktrees, Worktree } from '../git/worktrees';
import { ProjectCommonDirCache } from '../project/projectCommonDirCache';
import { ActiveWorktreeStore } from '../switch/activeWorktreeStore';
import { WorktreeListCacheStore } from '../worktree/worktreeListCacheStore';
import { WorktreeOrderStore } from '../worktree/worktreeOrderStore';
import { reconcileWorktreeOrder } from './reconcileWorktreeOrder';
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
  constructor(
    public readonly projectPath: string,
    public readonly worktree: Worktree,
    activeWorktreePath: string | undefined,
    public readonly mainWorktreePath: string | undefined,
  ) {
    const item = describeWorktreeTreeItem(worktree, activeWorktreePath, mainWorktreePath);
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

  constructor(
    private readonly activeWorktrees: ActiveWorktreeStore,
    private readonly worktreeOrders: WorktreeOrderStore,
    private readonly worktreeListCache: Pick<WorktreeListCacheStore, 'get' | 'set'> = {
      get: () => undefined,
      set: async () => undefined,
    },
    private readonly projectCommonDirCache: Pick<ProjectCommonDirCache, 'get' | 'set'> = {
      get: () => undefined,
      set: async () => undefined,
    },
  ) {}

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

  private getWorktreeChildren(element: ProjectNode): Node[] | Promise<Node[]> {
    const activeWorktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const commonDir =
      this.projectCommonDirCache.get(element.projectPath) ??
      this.projectCommonDirs.get(element.projectPath) ??
      undefined;

    if (commonDir !== undefined) {
      const cached = this.worktreeListCache.get(commonDir);
      if (cached !== undefined) {
        this.refreshWorktreesInBackground(element.projectPath, commonDir, cached);
        return this.toWorktreeNodes(
          element.projectPath,
          cached,
          commonDir,
          activeWorktreePath,
        );
      }
    }

    return this.loadWorktreeChildren(element.projectPath, commonDir, activeWorktreePath);
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
    const commonDir = await this.getCommonDirSafeCached(seedPath);
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
      const registered = await this.getCommonDirSafeCached(projectPath);
      if (registered !== null && registered === commonDir) return true;
    }
    return false;
  }

  private resolveActiveProject(): void {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.setActiveProjectCommonDir(null);
      return;
    }

    const cached = this.projectCommonDirCache.get(folder.uri.fsPath);
    if (cached !== undefined) this.setActiveProjectCommonDir(cached, false);
    if (this.resolvingActiveProject) return;

    this.resolvingActiveProject = true;
    void getCommonDirSafe(folder.uri.fsPath)
      .then(async (commonDir) => {
        if (commonDir !== null) await this.projectCommonDirCache.set(folder.uri.fsPath, commonDir);
        this.setActiveProjectCommonDir(commonDir);
      })
      .finally(() => {
        this.resolvingActiveProject = false;
      });
  }

  private resolveProjectCommonDir(projectPath: string): void {
    const cached = this.projectCommonDirCache.get(projectPath);
    if (cached !== undefined) {
      this.projectCommonDirs.set(projectPath, cached);
      this.refreshProjectCommonDirInBackground(projectPath, cached);
      return;
    }
    if (this.projectCommonDirs.has(projectPath) || this.resolvingProjectPaths.has(projectPath)) return;

    this.refreshProjectCommonDirInBackground(projectPath, undefined);
  }

  private refreshProjectCommonDirInBackground(projectPath: string, previous: string | undefined): void {
    if (this.resolvingProjectPaths.has(projectPath)) return;
    this.resolvingProjectPaths.add(projectPath);
    void getCommonDir(projectPath)
      .then(async (commonDir) => {
        await this.projectCommonDirCache.set(projectPath, commonDir);
        this.projectCommonDirs.set(projectPath, commonDir);
        if (previous !== commonDir) this._onDidChangeTreeData.fire(undefined);
      })
      .catch(() => {
        if (previous === undefined) {
          this.projectCommonDirs.set(projectPath, null);
          this._onDidChangeTreeData.fire(undefined);
        }
      })
      .finally(() => {
        this.resolvingProjectPaths.delete(projectPath);
      });
  }

  private setActiveProjectCommonDir(commonDir: string | null, fire = true): void {
    if (this.activeProjectCommonDir === commonDir) return;
    this.activeProjectCommonDir = commonDir;
    if (fire) this._onDidChangeTreeData.fire(undefined);
  }

  private async getCommonDirSafeCached(projectPath: string): Promise<string | null> {
    const cached = this.projectCommonDirCache.get(projectPath);
    if (cached !== undefined) return cached;
    const commonDir = await getCommonDirSafe(projectPath);
    if (commonDir !== null) await this.projectCommonDirCache.set(projectPath, commonDir);
    return commonDir;
  }

  private async loadWorktreeChildren(
    projectPath: string,
    knownCommonDir: string | undefined,
    activeWorktreePath: string | undefined,
  ): Promise<Node[]> {
    const gitWorktrees = await listWorktrees(projectPath);
    const commonDir = knownCommonDir ?? (await this.getCommonDirSafeCached(projectPath)) ?? undefined;
    if (commonDir !== undefined) await this.worktreeListCache.set(commonDir, gitWorktrees);
    return this.toWorktreeNodes(projectPath, gitWorktrees, commonDir, activeWorktreePath);
  }

  private refreshWorktreesInBackground(
    projectPath: string,
    commonDir: string,
    previous: readonly Worktree[],
  ): void {
    void listWorktrees(projectPath)
      .then(async (worktrees) => {
        if (sameWorktrees(previous, worktrees)) return;
        await this.worktreeListCache.set(commonDir, worktrees);
        this._onDidChangeTreeData.fire(undefined);
      })
      .catch(() => undefined);
  }

  private toWorktreeNodes(
    projectPath: string,
    gitWorktrees: readonly Worktree[],
    commonDir: string | undefined,
    activeWorktreePath: string | undefined,
  ): WorktreeNode[] {
    const worktrees = reconcileWorktreeOrder(
      commonDir === undefined ? undefined : this.worktreeOrders.get(commonDir),
      [...gitWorktrees],
    );
    const mainWorktreePath = gitWorktrees.find((w) => !w.bare)?.path;
    return worktrees.map((w) => new WorktreeNode(projectPath, w, activeWorktreePath, mainWorktreePath));
  }
}

function sameWorktrees(left: readonly Worktree[], right: readonly Worktree[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((worktree, index) => sameWorktree(worktree, right[index]));
}

function sameWorktree(left: Worktree, right: Worktree): boolean {
  return (
    left.path === right.path &&
    left.head === right.head &&
    left.branch === right.branch &&
    left.bare === right.bare &&
    left.detached === right.detached &&
    left.locked === right.locked
  );
}
