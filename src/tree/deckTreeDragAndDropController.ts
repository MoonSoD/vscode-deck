import * as vscode from 'vscode';
import { getCommonDirSafe, listWorktrees } from '../git/worktrees';
import { ProjectRegistryStore } from '../project/projectRegistryStore';
import { WorktreeOrderStore } from '../worktree/worktreeOrderStore';
import { reconcileWorktreeOrder } from './reconcileWorktreeOrder';
import { DropPosition, reorderArray } from './reorderArray';

const DECK_TREE_MIME = 'application/vnd.code.tree.deck.projects';

type DragPayload =
  | {
      kind: 'project';
      sourcePath: string;
    }
  | {
      kind: 'worktree';
      sourcePath: string;
      projectPath: string;
    };

interface ProjectNodeLike {
  contextValue: 'deck.project';
  projectPath: string;
}

interface WorktreeNodeLike {
  contextValue: string;
  projectPath: string;
  worktree: {
    path: string;
  };
}

type DeckNodeLike = ProjectNodeLike | WorktreeNodeLike;

export class DeckTreeDragAndDropController
  implements vscode.TreeDragAndDropController<DeckNodeLike>
{
  readonly dragMimeTypes = [DECK_TREE_MIME];
  readonly dropMimeTypes = [DECK_TREE_MIME];

  constructor(
    private readonly refresh: () => void,
    private readonly projectRegistry: Pick<ProjectRegistryStore, 'list' | 'replace'>,
    private readonly worktreeOrders: WorktreeOrderStore,
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
    const payload = dataTransfer.get(DECK_TREE_MIME)?.value as DragPayload | undefined;
    if (!payload) return;

    if (payload.kind === 'worktree') {
      if (!target) return;
      await this.dropWorktree(payload, target);
      return;
    }

    const projects = this.projectRegistry.list();
    let reordered: string[];
    if (target) {
      if (!isProjectNode(target)) return;
      const position = dropPosition(projects, payload.sourcePath, target.projectPath);
      reordered = reorderArray(
        projects,
        payload.sourcePath,
        target.projectPath,
        position,
      );
    } else {
      if (!projects.includes(payload.sourcePath)) return;
      reordered = [
        ...projects.filter((projectPath) => projectPath !== payload.sourcePath),
        payload.sourcePath,
      ];
    }

    if (sameOrder(projects, reordered)) return;

    await this.projectRegistry.replace(reordered);
    this.refresh();
  }

  private async dropWorktree(
    payload: Extract<DragPayload, { kind: 'worktree' }>,
    target: DeckNodeLike,
  ): Promise<void> {
    if (!isWorktreeNode(target) || payload.projectPath !== target.projectPath) return;

    const commonDir = await getCommonDirSafe(target.projectPath);
    if (commonDir === null) return;

    const gitWorktrees = await listWorktrees(target.projectPath);
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
}

function toPayload(node: DeckNodeLike): DragPayload | undefined {
  if (isProjectNode(node)) {
    return { kind: 'project', sourcePath: node.projectPath };
  }
  if (isWorktreeNode(node)) {
    return {
      kind: 'worktree',
      sourcePath: node.worktree.path,
      projectPath: node.projectPath,
    };
  }
  return undefined;
}

function isProjectNode(node: DeckNodeLike): node is ProjectNodeLike {
  return node.contextValue === 'deck.project';
}

function isWorktreeNode(node: DeckNodeLike): node is WorktreeNodeLike {
  return (
    node.contextValue?.startsWith('deck.worktree') === true &&
    'worktree' in node
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
