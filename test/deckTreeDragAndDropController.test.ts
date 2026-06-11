import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  repositories: ['/repo/a', '/repo/b', '/repo/c', '/repo/d'],
  listWorktrees: vi.fn(),
  getCommonDirSafe: vi.fn(),
  listSessions: vi.fn(),
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
import { RepositoryRegistryStore } from '../src/repository/repositoryRegistryStore';
import { TerminalOrderStore } from '../src/terminal/terminalOrderStore';
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

function repository(repositoryPath: string) {
  return { contextValue: 'deck.repository', repositoryPath };
}

function worktree(repositoryPath: string, worktreePath: string) {
  return {
    contextValue: 'deck.worktree',
    repositoryPath,
    worktree: { path: worktreePath },
  };
}

function terminal(repositoryPath: string, worktreePath: string, sessionName: string) {
  return {
    contextValue: 'deck.terminal.foreign',
    repositoryPath,
    worktreePath,
    terminal: { sessionName, windowName: sessionName },
  };
}

function createController(refresh = vi.fn()) {
  const repositoryRegistry = {
    list: vi.fn(() => vscodeState.repositories),
    replace: vi.fn(async (repositories: readonly string[]) => {
      vscodeState.repositories = [...repositories];
    }),
  } as unknown as RepositoryRegistryStore;
  const worktreeOrders = {
    get: vi.fn(),
    set: vi.fn(async () => undefined),
  } as unknown as WorktreeOrderStore;
  const terminalOrders = {
    get: vi.fn(() => [
      'wt-_repo_a-main__term-1',
      'wt-_repo_a-main__term-2',
      'wt-_repo_a-main__term-3',
    ]),
    set: vi.fn(async () => undefined),
  } as unknown as TerminalOrderStore;
  const tmux = {
    listSessions: vscodeState.listSessions,
  };
  return {
    controller: new DeckTreeDragAndDropController(refresh, repositoryRegistry, worktreeOrders, terminalOrders, tmux),
    repositoryRegistry,
    refresh,
    terminalOrders,
    worktreeOrders,
  };
}

describe('DeckTreeDragAndDropController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.repositories = ['/repo/a', '/repo/b', '/repo/c', '/repo/d'];
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
    vscodeState.listSessions.mockResolvedValue([
      { sessionName: 'wt-_repo_a-main__term-1', windowName: 'one' },
      { sessionName: 'wt-_repo_a-main__term-2', windowName: 'two' },
      { sessionName: 'wt-_repo_a-main__term-3', windowName: 'three' },
    ]);
  });

  it('reorders Repositories in RepositoryRegistryStore and refreshes the tree', async () => {
    const { controller, repositoryRegistry, refresh } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([repository('/repo/b')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(repository('/repo/d'), dataTransfer as vscode.DataTransfer, {} as never);

    expect(repositoryRegistry.replace).toHaveBeenCalledWith(
      ['/repo/a', '/repo/c', '/repo/d', '/repo/b'],
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('moves Repositories upward above the target', async () => {
    const { controller, repositoryRegistry, refresh } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([repository('/repo/d')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(repository('/repo/b'), dataTransfer as vscode.DataTransfer, {} as never);

    expect(repositoryRegistry.replace).toHaveBeenCalledWith(
      ['/repo/a', '/repo/d', '/repo/b', '/repo/c'],
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('moves Repositories to the bottom when dropped on the empty root area', async () => {
    const { controller, repositoryRegistry, refresh } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([repository('/repo/b')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(undefined, dataTransfer as vscode.DataTransfer, {} as never);

    expect(repositoryRegistry.replace).toHaveBeenCalledWith(
      ['/repo/a', '/repo/c', '/repo/d', '/repo/b'],
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('ignores Repository drops onto Worktree rows', async () => {
    const { controller, refresh } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([repository('/repo/b')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(
      worktree('/repo/a', '/repo/a-feature'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(vscodeState.repositories).toEqual(['/repo/a', '/repo/b', '/repo/c', '/repo/d']);
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

  it('reorders sibling Terminals and refreshes the tree', async () => {
    const { controller, refresh, terminalOrders } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-3')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(terminalOrders.set).toHaveBeenCalledWith('/repo/a-main', [
      'wt-_repo_a-main__term-3',
      'wt-_repo_a-main__term-1',
      'wt-_repo_a-main__term-2',
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('reorders Terminals from live term-N order when no TerminalOrder is stored', async () => {
    const { controller, refresh, terminalOrders } = createController();
    vi.mocked(terminalOrders.get).mockReturnValue(undefined);
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-3'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(terminalOrders.set).toHaveBeenCalledWith('/repo/a-main', [
      'wt-_repo_a-main__term-2',
      'wt-_repo_a-main__term-3',
      'wt-_repo_a-main__term-1',
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('ignores Terminal drops onto another Worktree terminal', async () => {
    const { controller, refresh, terminalOrders } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(
      terminal('/repo/a', '/repo/a-feature', 'wt-_repo_a-feature__term-1'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(terminalOrders.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores Terminal drops onto non-Terminal rows and empty space', async () => {
    const { controller, refresh, terminalOrders } = createController();
    const repositoryDrop = new DataTransferMock();
    const worktreeDrop = new DataTransferMock();
    const emptyDrop = new DataTransferMock();

    controller.handleDrag?.(
      [terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1')],
      repositoryDrop as vscode.DataTransfer,
      {} as never,
    );
    controller.handleDrag?.(
      [terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1')],
      worktreeDrop as vscode.DataTransfer,
      {} as never,
    );
    controller.handleDrag?.(
      [terminal('/repo/a', '/repo/a-main', 'wt-_repo_a-main__term-1')],
      emptyDrop as vscode.DataTransfer,
      {} as never,
    );

    await controller.handleDrop?.(repository('/repo/a'), repositoryDrop as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(
      worktree('/repo/a', '/repo/a-main'),
      worktreeDrop as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(undefined, emptyDrop as vscode.DataTransfer, {} as never);

    expect(terminalOrders.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores Worktree drops onto Repository rows', async () => {
    const { controller, refresh, worktreeOrders } = createController();
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [worktree('/repo/a', '/repo/a-feature')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(repository('/repo/b'), dataTransfer as vscode.DataTransfer, {} as never);

    expect(vscodeState.repositories).toEqual(['/repo/a', '/repo/b', '/repo/c', '/repo/d']);
    expect(worktreeOrders.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores Worktree drops onto another Repository worktree', async () => {
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
