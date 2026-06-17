import * as path from 'node:path';
import * as vscode from 'vscode';
import { getCommonDir, listWorktrees, Worktree } from '../git/worktrees';
import { RepositoryCommonDirCache, resolveCommonDirSafe } from '../repository/repositoryCommonDirCache';
import { RepositoryRegistryStore } from '../repository/repositoryRegistryStore';
import { ActiveWorktreeStore } from '../switch/activeWorktreeStore';
import { WorktreeListCacheStore } from '../worktree/worktreeListCacheStore';
import { WorktreeOrderStore } from '../worktree/worktreeOrderStore';
import { terminalSessionPrefix } from '../terminal/tmuxSafe';
import { TerminalOrderStore } from '../terminal/terminalOrderStore';
import type { TmuxSession } from '../terminal/tmuxCli';
import {
  type CachedTerminalSession,
  toCachedTerminalSessions,
} from '../terminal/terminalSession';
import type { AgentStatus } from '../agent/agentStatusStore';
import {
  agentStatusDecorationUri,
  AgentStatusDecorationRollups,
  type AgentStatusDecorationTerminal,
} from '../agent/agentStatusDecorations';
import { resolveAgentIcon } from '../agent/agentIconResolver';
import { excludePending } from './excludePending';
import { reconcileWorktreeOrder } from './reconcileWorktreeOrder';
import { reconcileTerminalOrder } from './reconcileTerminalOrder';
import { pruneOrder } from './pruneOrder';
import {
  describeRepositoryTreeItem,
  describeTmuxUnavailableTreeItem,
  describeTerminalTreeItem,
  describeWorktreeTreeItem,
} from './worktreeTreeItem';

export type RepositoryTreeNode = RepositoryNode | WorktreeNode | TerminalNode | TmuxUnavailableNode;

const resourcesDir = path.join(__dirname, '..', '..', 'resources');

// The terminal row's left icon carries agent identity, not status (status is
// the right-side decoration). The Claude marks ship as raster assets because
// VS Code currently renders custom tree SVGs black (microsoft/vscode#311339)
// and animated GIFs are the only sanctioned way to animate a custom tree icon.
function terminalIconPath(windowName: string, status?: AgentStatus): vscode.Uri | vscode.ThemeIcon {
  return resolveAgentIcon({ windowName, status, resourcesDir }, {
    uriFile: vscode.Uri.file,
    themeIcon: (id) => new vscode.ThemeIcon(id),
  }).iconPath;
}

interface TerminalSessionLister {
  listSessions(prefix?: string): Promise<TmuxSession[]>;
}

interface AgentStatusLookup {
  get(sessionName: string): AgentStatus | undefined;
  entries(): IterableIterator<[string, AgentStatus]>;
  onDidChange(listener: () => void): { dispose(): void };
}

// Stable TreeItem.id values let VS Code persist expand/collapse + selection
// across reloads (it stores state per id under workbench.tree.<viewId>).

class RepositoryNode extends vscode.TreeItem {
  constructor(
    public readonly repositoryPath: string,
    isActiveRepository: boolean,
  ) {
    const item = describeRepositoryTreeItem(repositoryPath, isActiveRepository);
    super(item.label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `repository::${repositoryPath}`;
    this.contextValue = 'deck.repository';
    this.description = item.description;
    this.tooltip = repositoryPath;
    this.resourceUri = toDecorationUri('repository', repositoryPath);
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
    super(item.label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = `worktree::${worktree.path}`;
    this.contextValue = item.contextValue;
    this.description = item.description;
    this.resourceUri = toDecorationUri('worktree', worktree.path);
    this.iconPath = new vscode.ThemeIcon(item.iconId);
  }
}

class TerminalNode extends vscode.TreeItem {
  constructor(
    public readonly terminal: TmuxSession,
    public readonly worktreeNode: WorktreeNode,
    isActiveWorktree: boolean,
    status?: AgentStatus,
  ) {
    const item = describeTerminalTreeItem(
      terminal.windowName,
      isActiveWorktree,
      status,
      terminal.paneTitle,
    );
    super(item.label, vscode.TreeItemCollapsibleState.None);
    this.id = `terminal::${terminal.sessionName}`;
    this.contextValue = item.contextValue;
    this.description = item.description;
    this.tooltip = item.tooltip;
    this.resourceUri = toDecorationUri('terminal', terminal.sessionName);
    this.iconPath = terminalIconPath(terminal.windowName, status);
    this.command = {
      command: 'deck.openTerminal',
      title: 'Open Terminal',
      arguments: [this],
    };
  }

  get repositoryPath(): string {
    return this.worktreeNode.repositoryPath;
  }

  get worktreePath(): string {
    return this.worktreeNode.worktree.path;
  }
}

class TmuxUnavailableNode extends vscode.TreeItem {
  constructor(public readonly worktreeNode: WorktreeNode) {
    const item = describeTmuxUnavailableTreeItem();
    super(item.label, vscode.TreeItemCollapsibleState.None);
    this.id = `tmux-unavailable::${worktreeNode.worktree.path}`;
    this.contextValue = item.contextValue;
    this.tooltip = item.tooltip;
    this.iconPath = new vscode.ThemeIcon(item.iconId);
  }
}

export class RepositoryTreeProvider implements vscode.TreeDataProvider<RepositoryTreeNode> {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<RepositoryTreeNode | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  readonly agentStatusDecorationRollups = new AgentStatusDecorationRollups();
  private activeRepositoryCommonDir: string | null = null;
  private resolvingActiveRepository = false;
  private readonly repositoryCommonDirs = new Map<string, string | null>();
  private readonly resolvingRepositoryPaths = new Set<string>();
  private readonly refreshingWorktrees = new Set<string>();
  private readonly knownWorktreeRepositories = new Map<string, string>();
  private readonly knownTerminals = new Map<string, AgentStatusDecorationTerminal>();
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
    private readonly agentStatuses?: AgentStatusLookup,
    private readonly terminalOrders?: Pick<TerminalOrderStore, 'get' | 'set'>,
    private readonly ensureSnapshotRestored: () => Promise<void> = () => Promise.resolve(),
  ) {
    this.syncAgentStatusDecorations();
    this.agentStatuses?.onDidChange(() => {
      this.syncAgentStatusDecorations();
      this.refresh();
    });

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

  getTreeItem(element: RepositoryTreeNode): vscode.TreeItem {
    return element;
  }

  setCollapsed(element: RepositoryTreeNode, collapsed: boolean): void {
    if (element instanceof RepositoryNode) {
      this.agentStatusDecorationRollups.setCollapsed('repository', element.repositoryPath, collapsed);
    } else if (element instanceof WorktreeNode) {
      this.agentStatusDecorationRollups.setCollapsed('worktree', element.worktree.path, collapsed);
    }
  }

  getParent(element: RepositoryTreeNode): RepositoryTreeNode | undefined {
    if (element instanceof WorktreeNode) {
      return new RepositoryNode(
        element.repositoryPath,
        this.isActiveRepository(element.repositoryPath),
      );
    }
    if (element instanceof TerminalNode) {
      return this.toParentWorktreeNode(element.worktreeNode);
    }
    if (element instanceof TmuxUnavailableNode) {
      return this.toParentWorktreeNode(element.worktreeNode);
    }
    return undefined;
  }

  getChildren(element?: RepositoryTreeNode): vscode.ProviderResult<RepositoryTreeNode[]> {
    if (!element) {
      // Sync return: any `await` here would yield to the event loop and let
      // viewsWelcome ("No repositories yet") flash on every tree.refresh().
      const repositories = this.repositoryRegistry.list();
      this.resolveActiveRepository();
      const nodes = repositories.map((p) => {
        this.resolveRepositoryCommonDir(p);
        this.syncCachedDecorationWorktrees(p);
        return new RepositoryNode(p, this.isActiveRepository(p));
      });
      this.syncAgentStatusDecorations();
      return nodes;
    }
    if (element instanceof RepositoryNode) {
      return this.getWorktreeChildren(element);
    }
    if (element instanceof WorktreeNode) {
      if (!this.tmuxAvailable) return [new TmuxUnavailableNode(element)];
      return this.getTerminalChildren(element);
    }
    return [];
  }

  async findTerminal(
    sessionName: string,
    worktreePath: string,
  ): Promise<RepositoryTreeNode | undefined> {
    return this.findTerminalNode(
      sessionName,
      (worktree) => path.resolve(worktree.worktree.path) === path.resolve(worktreePath),
    );
  }

  async findTerminalBySessionName(sessionName: string): Promise<RepositoryTreeNode | undefined> {
    return this.findTerminalNode(sessionName);
  }

  async describeSession(sessionName: string): Promise<{ repo: string; branch: string } | undefined> {
    const worktree = await this.findWorktreeNodeForSession(sessionName);
    if (worktree === undefined) return undefined;
    return {
      repo: path.basename(worktree.repositoryPath),
      branch: worktree.worktree.branch ?? worktree.worktree.path,
    };
  }

  private async findTerminalNode(
    sessionName: string,
    worktreeMatches: (worktree: WorktreeNode) => boolean = () => true,
  ): Promise<TerminalNode | undefined> {
    const worktree = await this.findWorktreeNodeForSession(sessionName, worktreeMatches);
    if (worktree === undefined) return undefined;
    const terminals = await this.resolveChildren(worktree);
    for (const terminal of terminals) {
      if (terminal instanceof TerminalNode && terminal.terminal.sessionName === sessionName) {
        return terminal;
      }
    }
    return undefined;
  }

  private async findWorktreeNodeForSession(
    sessionName: string,
    worktreeMatches: (worktree: WorktreeNode) => boolean = () => true,
  ): Promise<WorktreeNode | undefined> {
    const repositories = await this.resolveChildren();
    for (const repository of repositories) {
      if (!(repository instanceof RepositoryNode)) continue;
      const worktrees = await this.resolveChildren(repository);
      for (const worktree of worktrees) {
        if (!(worktree instanceof WorktreeNode)) continue;
        // The session name embeds the worktree prefix — skip before the
        // per-worktree tmux query.
        if (!sessionName.startsWith(terminalSessionPrefix(worktree.worktree.path))) continue;
        if (!worktreeMatches(worktree)) continue;
        return worktree;
      }
    }
    return undefined;
  }

  private async resolveChildren(element?: RepositoryTreeNode): Promise<RepositoryTreeNode[]> {
    return (await Promise.resolve(this.getChildren(element))) ?? [];
  }

  private currentWorktreePath(): string | undefined {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  }

  private isActiveRepository(repositoryPath: string): boolean {
    const repositoryCommonDir = this.repositoryCommonDirs.get(repositoryPath);
    return (
      repositoryCommonDir !== undefined &&
      repositoryCommonDir !== null &&
      repositoryCommonDir === this.activeRepositoryCommonDir
    );
  }

  private toParentWorktreeNode(worktreeNode: WorktreeNode): WorktreeNode {
    return new WorktreeNode(
      worktreeNode.repositoryPath,
      worktreeNode.worktree,
      this.currentWorktreePath(),
      worktreeNode.mainWorktreePath,
    );
  }

  private getWorktreeChildren(element: RepositoryNode): RepositoryTreeNode[] | Promise<RepositoryTreeNode[]> {
    const activeWorktreePath = this.currentWorktreePath();
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
  ): Promise<RepositoryTreeNode[]> {
    const pendingAtListStart = new Set(this.pendingWorktreeRemovals);
    const gitWorktrees = await listWorktrees(repositoryPath);
    const visibleWorktrees = this.visibleWorktrees(gitWorktrees, pendingAtListStart);
    const commonDir =
      knownCommonDir ??
      (await resolveCommonDirSafe(this.repositoryCommonDirCache, repositoryPath)) ??
      undefined;
    await this.pruneWorktreeOrder(commonDir, gitWorktrees);
    if (commonDir !== undefined) await this.worktreeListCache.set(commonDir, visibleWorktrees);
    return this.toWorktreeNodes(repositoryPath, visibleWorktrees, commonDir, activeWorktreePath);
  }

  private async getTerminalChildren(element: WorktreeNode): Promise<RepositoryTreeNode[]> {
    // Wait for the DeckSocket to finish restoring before listing — otherwise a
    // reopen-after-kill reads an empty/partial session list, and the prune below
    // would mistake the not-yet-restored Terminals for dead ones and wipe the
    // stored TerminalOrder. Same hazard the tab-reattach gate guards against.
    await this.ensureSnapshotRestored();
    const liveTerminals = toCachedTerminalSessions(
      element.worktree.path,
      await this.tmux.listSessions(terminalSessionPrefix(element.worktree.path)),
    );
    const storedOrder = this.terminalOrders?.get(element.worktree.path);
    const prunedStoredOrder = storedOrder === undefined
      ? undefined
      : pruneOrder(storedOrder, new Set(liveTerminals.map((terminal) => terminal.sessionName)));
    if (prunedStoredOrder?.changed) {
      await this.terminalOrders?.set(element.worktree.path, prunedStoredOrder.order);
    }
    const terminals = reconcileTerminalOrder(
      prunedStoredOrder?.order,
      liveTerminals,
    );
    return this.toTerminalNodes(element, terminals);
  }

  private toTerminalNodes(element: WorktreeNode, terminals: readonly CachedTerminalSession[]): RepositoryTreeNode[] {
    const activeWorktreePath = this.currentWorktreePath();
    const isActiveWorktree =
      activeWorktreePath !== undefined &&
      path.resolve(element.worktree.path) === path.resolve(activeWorktreePath);
    const nodes = terminals.map(
      (terminal) => {
        this.knownTerminals.set(terminal.sessionName, {
          repositoryPath: element.repositoryPath,
          worktreePath: element.worktree.path,
          sessionName: terminal.sessionName,
        });
        return new TerminalNode(
          terminal,
          element,
          isActiveWorktree,
          this.agentStatuses?.get(terminal.sessionName),
        );
      },
    );
    this.syncAgentStatusDecorations();
    return nodes;
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
        await this.pruneWorktreeOrder(commonDir, worktrees);
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
    const nodes = worktrees.map((w) => {
      this.knownWorktreeRepositories.set(w.path, repositoryPath);
      return new WorktreeNode(
        repositoryPath,
        w,
        activeWorktreePath,
        mainWorktreePath,
      );
    });
    this.syncAgentStatusDecorations();
    return nodes;
  }

  private async pruneWorktreeOrder(commonDir: string | undefined, gitWorktrees: readonly Worktree[]): Promise<void> {
    if (commonDir === undefined) return;

    const storedOrder = this.worktreeOrders.get(commonDir);
    if (storedOrder === undefined) return;

    const prunedOrder = pruneOrder(storedOrder, new Set(gitWorktrees.map((worktree) => worktree.path)));
    if (prunedOrder.changed) {
      await this.worktreeOrders.set(commonDir, prunedOrder.order).catch(() => undefined);
    }
  }

  private visibleWorktrees(
    worktrees: readonly Worktree[],
    pendingAtListStart?: ReadonlySet<string>,
  ): Worktree[] {
    const currentlyVisible = excludePending(worktrees, this.pendingWorktreeRemovals);
    if (pendingAtListStart === undefined) return currentlyVisible;
    return excludePending(currentlyVisible, pendingAtListStart);
  }

  private syncCachedDecorationWorktrees(repositoryPath: string): void {
    const commonDir =
      this.repositoryCommonDirCache.get(repositoryPath) ??
      this.repositoryCommonDirs.get(repositoryPath) ??
      undefined;
    if (commonDir === undefined || commonDir === null) return;

    const worktrees = this.worktreeListCache.get(commonDir);
    if (worktrees === undefined) return;
    for (const worktree of this.visibleWorktrees(worktrees)) {
      this.knownWorktreeRepositories.set(worktree.path, repositoryPath);
    }
  }

  private syncAgentStatusDecorations(): void {
    const statuses = [...(this.agentStatuses?.entries() ?? [])];
    this.agentStatusDecorationRollups.setStatuses(statuses);
    const terminals = new Map(this.knownTerminals);
    for (const [worktreePath, repositoryPath] of this.knownWorktreeRepositories) {
      const prefix = terminalSessionPrefix(worktreePath);
      for (const [sessionName] of statuses) {
        if (!sessionName.startsWith(prefix)) continue;
        terminals.set(sessionName, { repositoryPath, worktreePath, sessionName });
      }
    }
    this.agentStatusDecorationRollups.setTerminals([...terminals.values()]);
  }
}

function toDecorationUri(
  kind: 'repository' | 'worktree' | 'terminal',
  id: string,
): vscode.Uri {
  const uri = agentStatusDecorationUri(kind, id);
  return vscode.Uri.from({
    scheme: uri.scheme,
    authority: '',
    path: uri.path,
    query: '',
  });
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
