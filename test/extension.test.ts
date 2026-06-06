import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  addProjectArgs: undefined as unknown[] | undefined,
  addProjectRun: vi.fn(),
  configUpdate: vi.fn(),
  createTreeView: vi.fn(() => ({ dispose: vi.fn(), reveal: vi.fn(async () => undefined) })),
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  settingsProjects: ['/settings/repo'],
}));

vi.mock('vscode', () => ({
  ConfigurationTarget: {
    Global: 1,
  },
  commands: {
    executeCommand: vi.fn(),
    registerCommand: vscodeState.registerCommand,
  },
  window: {
    createTreeView: vscodeState.createTreeView,
  },
  workspace: {
    getConfiguration: () => ({
      get: <T>(_key: string, defaultValue: T) =>
        (vscodeState.settingsProjects as T | undefined) ?? defaultValue,
      update: vscodeState.configUpdate,
    }),
  },
}));

vi.mock('../src/switch/activeWorktreeStore', () => ({
  ActiveWorktreeStore: class {},
}));

vi.mock('../src/worktree/worktreeRootStore', () => ({
  WorktreeRootStore: class {},
}));

vi.mock('../src/worktree/branchDeletionPreferenceStore', () => ({
  BranchDeletionPreferenceStore: class {},
}));

vi.mock('../src/worktree/worktreeListCacheStore', () => ({
  WorktreeListCacheStore: class {},
}));

vi.mock('../src/project/projectCommonDirCache', () => ({
  ProjectCommonDirCache: class {},
}));

vi.mock('../src/project/addProjectCommand', () => ({
  AddProjectCommand: class {
    constructor(...args: unknown[]) {
      vscodeState.addProjectArgs = args;
    }

    run = vscodeState.addProjectRun;
  },
  VsCodeProjectFolderPicker: class {},
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
    getChildren = vi.fn(() => [{ projectPath: '/settings/repo' }]);
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
    vscodeState.addProjectArgs = undefined;
    vscodeState.settingsProjects = ['/settings/repo'];
    vscodeState.configUpdate.mockResolvedValue(undefined);
  });

  function createContext(globalProjects: string[] = []) {
    const values: Record<string, unknown> = { 'deck.projectRegistry': globalProjects };
    return {
      globalState: {
        get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
        update: vi.fn(async (key: string, value: unknown) => {
          values[key] = value;
        }),
      },
      subscriptions: [] as Array<{ dispose(): void }>,
      values,
    };
  }

  it('creates the Projects tree view with drag-and-drop enabled', async () => {
    const context = createContext();

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

  it('migrates deck.projects settings to ProjectRegistryStore and clears settings', async () => {
    const context = createContext(['/global/repo']);

    await activate(context as never);

    expect(context.values['deck.projectRegistry']).toEqual(['/global/repo', '/settings/repo']);
    expect(vscodeState.configUpdate).toHaveBeenCalledWith(
      'projects',
      undefined,
      vscode.ConfigurationTarget.Global,
    );
  });

  it('registers deck.addProject through AddProjectCommand', async () => {
    const context = createContext();

    await activate(context as never);
    const addProjectRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.addProject',
    );
    if (!addProjectRegistration) throw new Error('missing deck.addProject registration');
    await addProjectRegistration[1]();

    expect(vscodeState.addProjectRun).toHaveBeenCalledOnce();
  });
});
