import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  projects: ['/repo/a', '/repo/b', '/repo/c', '/repo/d'],
  listWorktrees: vi.fn(),
  getCommonDirSafe: vi.fn(),
}));

vi.mock('vscode', () => ({
  DataTransferItem: class {
    constructor(readonly value: unknown) {}
  },
}));

vi.mock('../src/git/worktrees', () => ({
  getCommonDirSafe: vscodeState.getCommonDirSafe,
  listWorktrees: vscodeState.listWorktrees,
}));

import * as vscode from 'vscode';
import { ProjectRegistryStore } from '../src/project/projectRegistryStore';
import { DeckTreeDragAndDropController } from '../src/tree/deckTreeDragAndDropController';
import { WorktreeOrderStore } from '../src/worktree/worktreeOrderStore';

class DataTransferMock {
  private readonly items = new Map<string, vscode.DataTransferItem>();

  get(mimeType: string): vscode.DataTransferItem | undefined {
    return this.items.get(mimeType);
  }

  set(mimeType: string, value: vscode.DataTransferItem): void {
    this.items.set(mimeType, value);
  }
}

function project(projectPath: string) {
  return { contextValue: 'deck.project', projectPath };
}

function worktree(projectPath: string, worktreePath: string) {
  return {
    contextValue: 'deck.worktree',
    projectPath,
    worktree: { path: worktreePath },
  };
}

function createController(refresh = vi.fn()) {
  const projectRegistry = {
    list: vi.fn(() => vscodeState.projects),
    replace: vi.fn(async (projects: readonly string[]) => {
      vscodeState.projects = [...projects];
    }),
  } as unknown as ProjectRegistryStore;
  const worktreeOrders = {
    get: vi.fn(),
    set: vi.fn(async () => undefined),
  } as unknown as WorktreeOrderStore;
  return {
    controller: new DeckTreeDragAndDropController(refresh, projectRegistry, worktreeOrders),
    projectRegistry,
    refresh,
    worktreeOrders,
  };
}

describe('DeckTreeDragAndDropController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.projects = ['/repo/a', '/repo/b', '/repo/c', '/repo/d'];
    vscodeState.getCommonDirSafe.mockResolvedValue('/git/a');
    vscodeState.listWorktrees.mockResolvedValue([
      {
        path: '/repo/a-main',
        head: 'a',
        bare: false,
        detached: false,
        branch: 'main',
      },
      {
        path: '/repo/a-feature',
        head: 'b',
        bare: false,
        detached: false,
        branch: 'feature',
      },
      {
        path: '/repo/a-fix',
        head: 'c',
        bare: false,
        detached: false,
        branch: 'fix',
      },
    ]);
  });

  it('reorders Projects in ProjectRegistryStore and refreshes the tree', async () => {
    const { controller, projectRegistry, refresh } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([project('/repo/b')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(project('/repo/d'), dataTransfer as vscode.DataTransfer, {} as never);

    expect(projectRegistry.replace).toHaveBeenCalledWith(
      ['/repo/a', '/repo/c', '/repo/d', '/repo/b'],
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('moves Projects upward above the target', async () => {
    const { controller, projectRegistry, refresh } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([project('/repo/d')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(project('/repo/b'), dataTransfer as vscode.DataTransfer, {} as never);

    expect(projectRegistry.replace).toHaveBeenCalledWith(
      ['/repo/a', '/repo/d', '/repo/b', '/repo/c'],
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('moves Projects to the bottom when dropped on the empty root area', async () => {
    const { controller, projectRegistry, refresh } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([project('/repo/b')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(undefined, dataTransfer as vscode.DataTransfer, {} as never);

    expect(projectRegistry.replace).toHaveBeenCalledWith(
      ['/repo/a', '/repo/c', '/repo/d', '/repo/b'],
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('ignores Project drops onto Worktree rows', async () => {
    const { controller, refresh } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([project('/repo/b')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(
      worktree('/repo/a', '/repo/a-feature'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(vscodeState.projects).toEqual(['/repo/a', '/repo/b', '/repo/c', '/repo/d']);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('reorders sibling Worktrees and refreshes the tree', async () => {
    const { controller, refresh, worktreeOrders } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [worktree('/repo/a', '/repo/a-feature')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      worktree('/repo/a', '/repo/a-main'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(worktreeOrders.set).toHaveBeenCalledWith('/git/a', [
      '/repo/a-feature',
      '/repo/a-main',
      '/repo/a-fix',
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('reorders Worktrees from the reconciled stored order', async () => {
    const { controller, refresh, worktreeOrders } = createController();
    vi.mocked(worktreeOrders.get).mockReturnValue(['/repo/a-fix', '/repo/a-main']);
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [worktree('/repo/a', '/repo/a-feature')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      worktree('/repo/a', '/repo/a-main'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(worktreeOrders.set).toHaveBeenCalledWith('/git/a', [
      '/repo/a-fix',
      '/repo/a-feature',
      '/repo/a-main',
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('ignores Worktree drops onto Project rows', async () => {
    const { controller, refresh, worktreeOrders } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [worktree('/repo/a', '/repo/a-feature')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(project('/repo/b'), dataTransfer as vscode.DataTransfer, {} as never);

    expect(vscodeState.projects).toEqual(['/repo/a', '/repo/b', '/repo/c', '/repo/d']);
    expect(worktreeOrders.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores Worktree drops onto another Project worktree', async () => {
    const { controller, refresh, worktreeOrders } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [worktree('/repo/a', '/repo/a-feature')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      worktree('/repo/b', '/repo/b-main'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(worktreeOrders.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
