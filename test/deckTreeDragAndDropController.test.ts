import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  projects: ['/repo/a', '/repo/b', '/repo/c', '/repo/d'],
  update: vi.fn(),
}));

vi.mock('vscode', () => ({
  ConfigurationTarget: {
    Global: 1,
  },
  DataTransferItem: class {
    constructor(readonly value: unknown) {}
  },
  workspace: {
    getConfiguration: () => ({
      get: <T>(_key: string, defaultValue: T) =>
        (vscodeState.projects as T | undefined) ?? defaultValue,
      update: vscodeState.update,
    }),
  },
}));

import * as vscode from 'vscode';
import { DeckTreeDragAndDropController } from '../src/tree/deckTreeDragAndDropController';

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

describe('DeckTreeDragAndDropController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.projects = ['/repo/a', '/repo/b', '/repo/c', '/repo/d'];
    vscodeState.update.mockResolvedValue(undefined);
  });

  it('reorders Projects in the deck.projects setting and refreshes the tree', async () => {
    const refresh = vi.fn();
    const controller = new DeckTreeDragAndDropController(refresh);
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([project('/repo/b')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(project('/repo/d'), dataTransfer as vscode.DataTransfer, {} as never);

    expect(vscodeState.update).toHaveBeenCalledWith(
      'projects',
      ['/repo/a', '/repo/c', '/repo/d', '/repo/b'],
      vscode.ConfigurationTarget.Global,
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('moves Projects upward above the target', async () => {
    const refresh = vi.fn();
    const controller = new DeckTreeDragAndDropController(refresh);
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([project('/repo/d')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(project('/repo/b'), dataTransfer as vscode.DataTransfer, {} as never);

    expect(vscodeState.update).toHaveBeenCalledWith(
      'projects',
      ['/repo/a', '/repo/d', '/repo/b', '/repo/c'],
      vscode.ConfigurationTarget.Global,
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('ignores Project drops onto Worktree rows', async () => {
    const refresh = vi.fn();
    const controller = new DeckTreeDragAndDropController(refresh);
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.([project('/repo/b')], dataTransfer as vscode.DataTransfer, {} as never);
    await controller.handleDrop?.(
      worktree('/repo/a', '/repo/a-feature'),
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );

    expect(vscodeState.update).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores Worktree drops in this slice', async () => {
    const refresh = vi.fn();
    const controller = new DeckTreeDragAndDropController(refresh);
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

    expect(vscodeState.update).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('ignores Worktree drops onto Project rows in this slice', async () => {
    const refresh = vi.fn();
    const controller = new DeckTreeDragAndDropController(refresh);
    const dataTransfer = new DataTransferMock();

    controller.handleDrag?.(
      [worktree('/repo/a', '/repo/a-feature')],
      dataTransfer as vscode.DataTransfer,
      {} as never,
    );
    await controller.handleDrop?.(project('/repo/b'), dataTransfer as vscode.DataTransfer, {} as never);

    expect(vscodeState.update).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
