import * as vscode from 'vscode';
import { getCommonDir, listWorktrees, Worktree } from '../git/worktrees';
import { ProjectCommonDirCache, resolveCommonDirSafe } from '../project/projectCommonDirCache';
import { ProjectRegistryStore } from '../project/projectRegistryStore';
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
  private readonly refreshingWorktrees = new Set<string>();

  constructor(
    private readonly projectRegistry: Pick<ProjectRegistryStore, 'list'>,
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
      const projects = this.projectRegistry.list();
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
    void resolveCommonDirSafe(this.projectCommonDirCache, folder.uri.fsPath)
      .then((commonDir) => {
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

  private async loadWorktreeChildren(
    projectPath: string,
    knownCommonDir: string | undefined,
    activeWorktreePath: string | undefined,
  ): Promise<Node[]> {
    const gitWorktrees = await listWorktrees(projectPath);
    const commonDir =
      knownCommonDir ??
      (await resolveCommonDirSafe(this.projectCommonDirCache, projectPath)) ??
      undefined;
    if (commonDir !== undefined) await this.worktreeListCache.set(commonDir, gitWorktrees);
    return this.toWorktreeNodes(projectPath, gitWorktrees, commonDir, activeWorktreePath);
  }

  private refreshWorktreesInBackground(
    projectPath: string,
    commonDir: string,
    previous: readonly Worktree[],
  ): void {
    if (this.refreshingWorktrees.has(commonDir)) return;
    this.refreshingWorktrees.add(commonDir);
    void listWorktrees(projectPath)
      .then(async (worktrees) => {
        if (sameWorktrees(previous, worktrees)) return;
        await this.worktreeListCache.set(commonDir, worktrees);
        this._onDidChangeTreeData.fire(undefined);
      })
      .catch(() => undefined)
      .finally(() => {
        this.refreshingWorktrees.delete(commonDir);
      });
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
