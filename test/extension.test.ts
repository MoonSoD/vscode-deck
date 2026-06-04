import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  consumeFocusIntent: vi.fn(async () => false),
}));

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vi.fn(),
    registerCommand: vscodeState.registerCommand,
  },
  window: {
    createTreeView: vscodeState.createTreeView,
  },
}));

vi.mock('../src/switch/activeWorktreeStore', () => ({
  ActiveWorktreeStore: class {
    consumeFocusIntent = vscodeState.consumeFocusIntent;
  },
}));

vi.mock('../src/worktree/worktreeRootStore', () => ({
  WorktreeRootStore: class {},
}));

vi.mock('../src/worktree/branchDeletionPreferenceStore', () => ({
  BranchDeletionPreferenceStore: class {},
}));

vi.mock('../src/switch/worktreeSwitcher', () => ({
  WorktreeSwitcher: class {},
}));

vi.mock('../src/worktree/addWorktreeCommand', () => ({
  AddWorktreeCommand: class {},
}));

vi.mock('../src/worktree/worktreeRemovalCommand', () => ({
  WorktreeRemovalCommand: class {},
}));

vi.mock('../src/project/projectRemovalCommand', () => ({
  ProjectRemovalCommand: class {},
}));

vi.mock('../src/tree/projectTree', () => ({
  ProjectTreeProvider: class {
    refresh = vi.fn();
    addProject = vi.fn();
  },
}));

vi.mock('../src/tree/deckTreeDragAndDropController', () => ({
  DeckTreeDragAndDropController: class {},
}));

import * as vscode from 'vscode';
import { activate } from '../src/extension';

describe('activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the Projects tree view with drag-and-drop enabled', async () => {
    const context = {
      globalState: {},
      subscriptions: [] as Array<{ dispose(): void }>,
    };

    await activate(context as never);

    expect(vscode.window.createTreeView).toHaveBeenCalledWith(
      'deck.projects',
      expect.objectContaining({
        canSelectMany: false,
        dragAndDropController: expect.any(Object),
        treeDataProvider: expect.any(Object),
      }),
    );
    expect(context.subscriptions[0]).toBe(vscodeState.createTreeView.mock.results[0].value);
  });
});
