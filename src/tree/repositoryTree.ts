import * as path from 'node:path';
import * as vscode from 'vscode';
import { getCommonDir, listWorktrees, Worktree } from '../git/worktrees';
import { RepositoryCommonDirCache, resolveCommonDirSafe } from '../repository/repositoryCommonDirCache';
import { RepositoryRegistryStore } from '../repository/repositoryRegistryStore';
import { ActiveWorktreeStore } from '../switch/activeWorktreeStore';
import { WorktreeListCacheStore } from '../worktree/worktreeListCacheStore';
import { WorktreeOrderStore } from '../worktree/worktreeOrderStore';
import { terminalSessionPrefix } from '../terminal/tmuxSafe';
import type { TmuxSession } from '../terminal/tmuxCli';
import {
  type CachedTerminalSession,
  toCachedTerminalSessions,
} from '../terminal/terminalSession';
import { excludePending } from './excludePending';
import { reconcileWorktreeOrder } from './reconcileWorktreeOrder';
import {
  describeRepositoryTreeItem,
  describeTmuxUnavailableTreeItem,
  describeTerminalAddTreeItem,
  describeTerminalTreeItem,
  describeWorktreeTreeItem,
} from './worktreeTreeItem';

type Node = RepositoryNode | WorktreeNode | TerminalNode | TerminalAddNode | TmuxUnavailableNode;

interface TerminalSessionLister {
  listSessions(prefix?: string): Promise<TmuxSession[]>;
}

// Stable TreeItem.id values let VS Code persist expand/collapse + selection
// across reloads (it stores state per id under workbench.tree.<viewId>).

class RepositoryNode extends vscode.TreeItem {
  constructor(public readonly repositoryPath: string, isActiveRepository: boolean) {
    const item = describeRepositoryTreeItem(repositoryPath, isActiveRepository);
    super(item.label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `repository::${repositoryPath}`;
    this.contextValue = 'deck.repository';
    this.description = item.description;
    this.tooltip = repositoryPath;
    this.iconPath = new vscode.ThemeIcon(item.iconId);
  }
}

class WorktreeNode extends vscode.TreeItem {
  constructor(
    public readonly repositoryPath: string,
    public readonly worktree: Worktree,
    activeWorktreePath: string | undefined,
    public readonly mainWorktreePath: string | undefined,
  ) {
    const item = describeWorktreeTreeItem(worktree, activeWorktreePath, mainWorktreePath);
    super(item.label, vscode.TreeItemCollapsibleState.Collapsed);
    this.id = `worktree::${worktree.path}`;
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

class TerminalAddNode extends vscode.TreeItem {
  constructor(worktreeNode: WorktreeNode) {
    const item = describeTerminalAddTreeItem();
    super(item.label, vscode.TreeItemCollapsibleState.None);
    this.id = `add-terminal::${worktreeNode.worktree.path}`;
    this.contextValue = item.contextValue;
    this.iconPath = new vscode.ThemeIcon(item.iconId);
    this.command = {
      command: 'deck.addTerminal',
      title: 'Add Terminal',
      arguments: [worktreeNode],
    };
  }
}

class TerminalNode extends vscode.TreeItem {
  constructor(
    public readonly terminal: TmuxSession,
    public readonly worktreePath: string,
    isActiveWorktree: boolean,
  ) {
    const item = describeTerminalTreeItem(terminal.windowName, isActiveWorktree);
    super(item.label, vscode.TreeItemCollapsibleState.None);
    this.id = `terminal::${terminal.sessionName}`;
    this.contextValue = item.contextValue;
    this.iconPath = new vscode.ThemeIcon(item.iconId);
    this.command = {
      command: 'deck.openTerminal',
      title: 'Open Terminal',
      arguments: [this],
    };
  }
}

class TmuxUnavailableNode extends vscode.TreeItem {
  constructor(worktreePath: string) {
    const item = describeTmuxUnavailableTreeItem();
    super(item.label, vscode.TreeItemCollapsibleState.None);
    this.id = `tmux-unavailable::${worktreePath}`;
    this.contextValue = item.contextValue;
    this.tooltip = item.tooltip;
    this.iconPath = new vscode.ThemeIcon(item.iconId);
  }
}

export class RepositoryTreeProvider implements vscode.TreeDataProvider<Node> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<Node | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  private activeRepositoryCommonDir: string | null = null;
  private resolvingActiveRepository = false;
  private readonly repositoryCommonDirs = new Map<string, string | null>();
  private readonly resolvingRepositoryPaths = new Set<string>();
  private readonly refreshingWorktrees = new Set<string>();
  private readonly tmux: TerminalSessionLister;
  private readonly tmuxAvailable: boolean;

  constructor(
    private readonly repositoryRegistry: Pick<RepositoryRegistryStore, 'list'>,
    private readonly activeWorktrees: ActiveWorktreeStore,
    private readonly worktreeOrders: WorktreeOrderStore,
    private readonly worktreeListCache: Pick<WorktreeListCacheStore, 'get' | 'set'> = {
      get: () => undefined,
      set: async () => undefined,
    },
    private readonly repositoryCommonDirCache: Pick<RepositoryCommonDirCache, 'get' | 'set'> = {
      get: () => undefined,
      set: async () => undefined,
    },
    tmuxOrAvailable: TerminalSessionLister | boolean = true,
    tmuxAvailable?: boolean,
    private readonly pendingWorktreeRemovals: ReadonlySet<string> = new Set(),
  ) {
    if (typeof tmuxOrAvailable === 'boolean') {
      this.tmux = { listSessions: async () => [] };
      this.tmuxAvailable = tmuxAvailable ?? tmuxOrAvailable;
      return;
    }

    this.tmux = tmuxOrAvailable;
    this.tmuxAvailable = tmuxAvailable ?? true;
  }

  refresh(): void {
    this.resolveActiveRepository();
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Node): vscode.TreeItem {
    return element;
  }

  getParent(_element: Node): Node | undefined {
    // RepositoryNodes are roots; WorktreeNodes aren't revealed programmatically
    // today, so undefined is correct for both. TreeView.reveal requires this
    // method to exist on the provider.
    return undefined;
  }

  getChildren(element?: Node): vscode.ProviderResult<Node[]> {
    if (!element) {
      // Sync return: any `await` here would yield to the event loop and let
      // viewsWelcome ("No repositories yet") flash on every tree.refresh().
      const repositories = this.repositoryRegistry.list();
      this.resolveActiveRepository();
      return repositories.map((p) => {
        this.resolveRepositoryCommonDir(p);
        const repositoryCommonDir = this.repositoryCommonDirs.get(p);
        return new RepositoryNode(
          p,
          repositoryCommonDir !== undefined &&
            repositoryCommonDir !== null &&
            repositoryCommonDir === this.activeRepositoryCommonDir,
        );
      });
    }
    if (element instanceof RepositoryNode) {
      return this.getWorktreeChildren(element);
    }
    if (element instanceof WorktreeNode) {
      if (!this.tmuxAvailable) return [new TmuxUnavailableNode(element.worktree.path)];
      return this.getTerminalChildren(element);
    }
    return [];
  }

  private getWorktreeChildren(element: RepositoryNode): Node[] | Promise<Node[]> {
    const activeWorktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const commonDir =
      this.repositoryCommonDirCache.get(element.repositoryPath) ??
      this.repositoryCommonDirs.get(element.repositoryPath) ??
      undefined;

    if (commonDir !== undefined) {
      const cached = this.worktreeListCache.get(commonDir);
      if (cached !== undefined) {
        const visibleCached = this.visibleWorktrees(cached);
        this.refreshWorktreesInBackground(element.repositoryPath, commonDir, visibleCached);
        return this.toWorktreeNodes(
          element.repositoryPath,
          visibleCached,
          commonDir,
          activeWorktreePath,
        );
      }
    }

    return this.loadWorktreeChildren(element.repositoryPath, commonDir, activeWorktreePath);
  }

  private resolveActiveRepository(): void {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      this.setActiveRepositoryCommonDir(null);
      return;
    }

    const cached = this.repositoryCommonDirCache.get(folder.uri.fsPath);
    if (cached !== undefined) this.setActiveRepositoryCommonDir(cached, false);
    if (this.resolvingActiveRepository) return;

    this.resolvingActiveRepository = true;
    void resolveCommonDirSafe(this.repositoryCommonDirCache, folder.uri.fsPath)
      .then((commonDir) => {
        this.setActiveRepositoryCommonDir(commonDir);
      })
      .finally(() => {
        this.resolvingActiveRepository = false;
      });
  }

  private resolveRepositoryCommonDir(repositoryPath: string): void {
    const cached = this.repositoryCommonDirCache.get(repositoryPath);
    if (cached !== undefined) {
      this.repositoryCommonDirs.set(repositoryPath, cached);
      this.refreshRepositoryCommonDirInBackground(repositoryPath, cached);
      return;
    }
    if (this.repositoryCommonDirs.has(repositoryPath) || this.resolvingRepositoryPaths.has(repositoryPath)) return;

    this.refreshRepositoryCommonDirInBackground(repositoryPath, undefined);
  }

  private refreshRepositoryCommonDirInBackground(repositoryPath: string, previous: string | undefined): void {
    if (this.resolvingRepositoryPaths.has(repositoryPath)) return;
    this.resolvingRepositoryPaths.add(repositoryPath);
    void getCommonDir(repositoryPath)
      .then(async (commonDir) => {
        await this.repositoryCommonDirCache.set(repositoryPath, commonDir);
        this.repositoryCommonDirs.set(repositoryPath, commonDir);
        if (previous !== commonDir) this._onDidChangeTreeData.fire(undefined);
      })
      .catch(() => {
        if (previous === undefined) {
          this.repositoryCommonDirs.set(repositoryPath, null);
          this._onDidChangeTreeData.fire(undefined);
        }
      })
      .finally(() => {
        this.resolvingRepositoryPaths.delete(repositoryPath);
      });
  }

  private setActiveRepositoryCommonDir(commonDir: string | null, fire = true): void {
    if (this.activeRepositoryCommonDir === commonDir) return;
    this.activeRepositoryCommonDir = commonDir;
    if (fire) this._onDidChangeTreeData.fire(undefined);
  }

  private async loadWorktreeChildren(
    repositoryPath: string,
    knownCommonDir: string | undefined,
    activeWorktreePath: string | undefined,
  ): Promise<Node[]> {
    const pendingAtListStart = new Set(this.pendingWorktreeRemovals);
    const gitWorktrees = await listWorktrees(repositoryPath);
    const visibleWorktrees = this.visibleWorktrees(gitWorktrees, pendingAtListStart);
    const commonDir =
      knownCommonDir ??
      (await resolveCommonDirSafe(this.repositoryCommonDirCache, repositoryPath)) ??
      undefined;
    if (commonDir !== undefined) await this.worktreeListCache.set(commonDir, visibleWorktrees);
    return this.toWorktreeNodes(repositoryPath, visibleWorktrees, commonDir, activeWorktreePath);
  }

  private async getTerminalChildren(element: WorktreeNode): Promise<Node[]> {
    const terminals = toCachedTerminalSessions(
      element.worktree.path,
      await this.tmux.listSessions(terminalSessionPrefix(element.worktree.path)),
    );
    return this.toTerminalNodes(element, terminals);
  }

  private toTerminalNodes(element: WorktreeNode, terminals: readonly CachedTerminalSession[]): Node[] {
    // The Worktree row's inline `+` icon is the always-available add affordance.
    // Show the explicit "Add Terminal" row only as the empty-state hint.
    if (terminals.length === 0) return [new TerminalAddNode(element)];
    const activeWorktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const isActiveWorktree =
      activeWorktreePath !== undefined &&
      path.resolve(element.worktree.path) === path.resolve(activeWorktreePath);
    return terminals.map(
      (terminal) => new TerminalNode(terminal, element.worktree.path, isActiveWorktree),
    );
  }

  private refreshWorktreesInBackground(
    repositoryPath: string,
    commonDir: string,
    previous: readonly Worktree[],
  ): void {
    if (this.refreshingWorktrees.has(commonDir)) return;
    this.refreshingWorktrees.add(commonDir);
    const pendingAtListStart = new Set(this.pendingWorktreeRemovals);
    void listWorktrees(repositoryPath)
      .then(async (worktrees) => {
        const visibleWorktrees = this.visibleWorktrees(worktrees, pendingAtListStart);
        if (sameWorktrees(previous, visibleWorktrees)) return;
        await this.worktreeListCache.set(commonDir, visibleWorktrees);
        this._onDidChangeTreeData.fire(undefined);
      })
      .catch(() => undefined)
      .finally(() => {
        this.refreshingWorktrees.delete(commonDir);
      });
  }

  private toWorktreeNodes(
    repositoryPath: string,
    gitWorktrees: readonly Worktree[],
    commonDir: string | undefined,
    activeWorktreePath: string | undefined,
  ): WorktreeNode[] {
    const worktrees = this.visibleWorktrees(
      reconcileWorktreeOrder(
        commonDir === undefined ? undefined : this.worktreeOrders.get(commonDir),
        [...gitWorktrees],
      ),
    );
    const mainWorktreePath = gitWorktrees.find((w) => !w.bare)?.path;
    return worktrees.map((w) => new WorktreeNode(repositoryPath, w, activeWorktreePath, mainWorktreePath));
  }

  private visibleWorktrees(
    worktrees: readonly Worktree[],
    pendingAtListStart?: ReadonlySet<string>,
  ): Worktree[] {
    const currentlyVisible = excludePending(worktrees, this.pendingWorktreeRemovals);
    if (pendingAtListStart === undefined) return currentlyVisible;
    return excludePending(currentlyVisible, pendingAtListStart);
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
