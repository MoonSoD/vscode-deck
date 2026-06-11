import * as vscode from 'vscode';
import { getCommonDirSafe, listWorktrees } from '../git/worktrees';
import {
  ActiveWorktreeStoreLike,
  DetachedOpenerLike,
  registerRepositorySeed,
  showRepositoryPostAddPrompt,
  SwitcherLike,
} from '../repository/registerRepositorySeed';
import {
  CommonDirCacheLike,
  PASS_THROUGH_COMMON_DIR_CACHE,
} from '../repository/repositoryCommonDirCache';
import { RepositoryRegistryStore } from '../repository/repositoryRegistryStore';
import { TerminalOrderStore } from '../terminal/terminalOrderStore';
import type { TmuxSession } from '../terminal/tmuxCli';
import { terminalSessionPrefix } from '../terminal/tmuxSafe';
import { WorktreeOrderStore } from '../worktree/worktreeOrderStore';
import { reconcileTerminalOrder } from './reconcileTerminalOrder';
import { reconcileWorktreeOrder } from './reconcileWorktreeOrder';
import { DropPosition, reorderArray } from './reorderArray';

const DECK_TREE_MIME = 'application/vnd.code.tree.deck.repositories';
const URI_LIST_MIME = 'text/uri-list';

type DragPayload =
  | {
      kind: 'repository';
      sourcePath: string;
    }
  | {
      kind: 'worktree';
      sourcePath: string;
      repositoryPath: string;
    }
  | {
      kind: 'terminal';
      sourceSessionName: string;
      worktreePath: string;
    };

interface RepositoryNodeLike {
  contextValue: 'deck.repository';
  repositoryPath: string;
}

interface WorktreeNodeLike {
  contextValue: string;
  repositoryPath: string;
  worktree: {
    path: string;
  };
}

interface TerminalNodeLike {
  contextValue: string;
  repositoryPath: string;
  worktreePath: string;
  terminal: {
    sessionName: string;
  };
}

interface TerminalSessionLister {
  listSessions(prefix?: string): Promise<TmuxSession[]>;
}

type DeckNodeLike = RepositoryNodeLike | WorktreeNodeLike | TerminalNodeLike;

export class DeckTreeDragAndDropController
  implements vscode.TreeDragAndDropController<DeckNodeLike>
{
  readonly dragMimeTypes = [DECK_TREE_MIME];
  readonly dropMimeTypes = [DECK_TREE_MIME, URI_LIST_MIME];

  constructor(
    private readonly refresh: () => void,
    private readonly repositoryRegistry: Pick<RepositoryRegistryStore, 'list' | 'append' | 'replace'>,
    private readonly worktreeOrders: WorktreeOrderStore,
    private readonly terminalOrders?: Pick<TerminalOrderStore, 'get' | 'set'>,
    private readonly tmux?: TerminalSessionLister,
    private readonly activeWorktrees?: ActiveWorktreeStoreLike,
    private readonly switcher?: SwitcherLike,
    private readonly detachedOpener?: DetachedOpenerLike,
    private readonly reveal?: (repositoryPath: string) => Promise<void>,
    private readonly repositoryCommonDirCache: CommonDirCacheLike = PASS_THROUGH_COMMON_DIR_CACHE,
  ) {}

  handleDrag(
    source: readonly DeckNodeLike[],
    dataTransfer: vscode.DataTransfer,
  ): void {
    const [node] = source;
    if (!node) return;

    const payload = toPayload(node);
    if (!payload) return;

    dataTransfer.set(DECK_TREE_MIME, new vscode.DataTransferItem(payload));
  }

  async handleDrop(
    target: DeckNodeLike | undefined,
    dataTransfer: vscode.DataTransfer,
  ): Promise<void> {
    const uriList = dataTransfer.get(URI_LIST_MIME)?.value;
    if (typeof uriList === 'string') {
      await this.dropRepositorySeeds(uriList);
      return;
    }

    const payload = dataTransfer.get(DECK_TREE_MIME)?.value as DragPayload | undefined;
    if (!payload) return;

    if (payload.kind === 'worktree') {
      if (!target) return;
      await this.dropWorktree(payload, target);
      return;
    }

    if (payload.kind === 'terminal') {
      if (!target) return;
      await this.dropTerminal(payload, target);
      return;
    }

    if (!target || !isRepositoryNode(target)) return;

    const repositories = this.repositoryRegistry.list();
    const position = dropPosition(repositories, payload.sourcePath, target.repositoryPath);
    const reordered = reorderArray(
      repositories,
      payload.sourcePath,
      target.repositoryPath,
      position,
    );

    if (sameOrder(repositories, reordered)) return;

    await this.repositoryRegistry.replace(reordered);
    this.refresh();
  }

  private async dropRepositorySeeds(uriList: string): Promise<void> {
    if (!this.activeWorktrees || !this.switcher || !this.detachedOpener || !this.reveal) return;

    const seedPaths = parseUriList(uriList);
    if (seedPaths.length === 0) return;

    if (seedPaths.length === 1) {
      const [seedPath] = seedPaths;
      const result = await registerRepositorySeed({
        seedPath,
        registry: this.repositoryRegistry,
        activeWorktrees: this.activeWorktrees,
        refresh: this.refresh,
        reveal: this.reveal,
        repositoryCommonDirCache: this.repositoryCommonDirCache,
      });
      if (result.kind === 'registered') {
        await showRepositoryPostAddPrompt(seedPath, this.switcher, this.detachedOpener);
      }
      return;
    }

    let lastRegisteredPath: string | undefined;
    for (const seedPath of seedPaths) {
      await registerRepositorySeed({
        seedPath,
        registry: this.repositoryRegistry,
        activeWorktrees: this.activeWorktrees,
        refresh: this.refresh,
        reveal: async (repositoryPath) => {
          lastRegisteredPath = repositoryPath;
        },
        repositoryCommonDirCache: this.repositoryCommonDirCache,
      });
    }
    if (lastRegisteredPath) await this.reveal(lastRegisteredPath);
  }

  private async dropWorktree(
    payload: Extract<DragPayload, { kind: 'worktree' }>,
    target: DeckNodeLike,
  ): Promise<void> {
    if (!isWorktreeNode(target) || payload.repositoryPath !== target.repositoryPath) return;

    const commonDir = await getCommonDirSafe(target.repositoryPath);
    if (commonDir === null) return;

    const gitWorktrees = await listWorktrees(target.repositoryPath);
    const worktrees = reconcileWorktreeOrder(
      this.worktreeOrders.get(commonDir),
      gitWorktrees,
    );
    const paths = worktrees.map((worktree) => worktree.path);
    const position = dropPosition(paths, payload.sourcePath, target.worktree.path);
    const reordered = reorderArray(paths, payload.sourcePath, target.worktree.path, position);

    if (sameOrder(paths, reordered)) return;

    await this.worktreeOrders.set(commonDir, reordered);
    this.refresh();
  }

  private async dropTerminal(
    payload: Extract<DragPayload, { kind: 'terminal' }>,
    target: DeckNodeLike,
  ): Promise<void> {
    if (!isTerminalNode(target) || payload.worktreePath !== target.worktreePath) return;
    if (!this.terminalOrders || !this.tmux) return;

    const liveSessions = await this.tmux.listSessions(terminalSessionPrefix(payload.worktreePath));
    const sessions = reconcileTerminalOrder(
      this.terminalOrders.get(payload.worktreePath),
      liveSessions,
    );
    const sessionNames = sessions.map((session) => session.sessionName);
    const position = dropPosition(sessionNames, payload.sourceSessionName, target.terminal.sessionName);
    const reordered = reorderArray(
      sessionNames,
      payload.sourceSessionName,
      target.terminal.sessionName,
      position,
    );

    if (sameOrder(sessionNames, reordered)) return;

    await this.terminalOrders.set(payload.worktreePath, reordered);
    this.refresh();
  }
}

function toPayload(node: DeckNodeLike): DragPayload | undefined {
  if (isRepositoryNode(node)) {
    return { kind: 'repository', sourcePath: node.repositoryPath };
  }
  if (isWorktreeNode(node)) {
    return {
      kind: 'worktree',
      sourcePath: node.worktree.path,
      repositoryPath: node.repositoryPath,
    };
  }
  if (isTerminalNode(node)) {
    return {
      kind: 'terminal',
      sourceSessionName: node.terminal.sessionName,
      worktreePath: node.worktreePath,
    };
  }
  return undefined;
}

function isRepositoryNode(node: DeckNodeLike): node is RepositoryNodeLike {
  return node.contextValue === 'deck.repository';
}

function isWorktreeNode(node: DeckNodeLike): node is WorktreeNodeLike {
  return (
    node.contextValue?.startsWith('deck.worktree') === true &&
    'worktree' in node
  );
}

function isTerminalNode(node: DeckNodeLike): node is TerminalNodeLike {
  return (
    node.contextValue?.startsWith('deck.terminal') === true &&
    'terminal' in node &&
    'worktreePath' in node
  );
}

function dropPosition(
  paths: readonly string[],
  sourcePath: string,
  targetPath: string,
): DropPosition {
  return paths.indexOf(sourcePath) < paths.indexOf(targetPath) ? 'below' : 'above';
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

function parseUriList(uriList: string): string[] {
  return uriList
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((uri) => vscode.Uri.parse(uri).fsPath)
    .filter((path) => path.length > 0);
}
