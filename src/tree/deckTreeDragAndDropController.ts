import * as vscode from 'vscode';
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

  constructor(private readonly refresh: () => void) {}

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
    if (!target || !isProjectNode(target)) return;

    const payload = dataTransfer.get(DECK_TREE_MIME)?.value as DragPayload | undefined;
    if (!payload || payload.kind !== 'project') return;

    const cfg = vscode.workspace.getConfiguration('deck');
    const projects = cfg.get<string[]>('projects', []);
    const position = projectDropPosition(projects, payload.sourcePath, target.projectPath);
    const reordered = reorderArray(
      projects,
      payload.sourcePath,
      target.projectPath,
      position,
    );

    if (sameOrder(projects, reordered)) return;

    await cfg.update('projects', reordered, vscode.ConfigurationTarget.Global);
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

function projectDropPosition(
  projects: readonly string[],
  sourcePath: string,
  targetPath: string,
): DropPosition {
  return projects.indexOf(sourcePath) < projects.indexOf(targetPath) ? 'below' : 'above';
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
