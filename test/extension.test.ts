import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  addProjectArgs: undefined as unknown[] | undefined,
  addProjectRun: vi.fn(),
  addTerminalRun: vi.fn(),
  configUpdate: vi.fn(),
  createTreeView: vi.fn(() => ({
    dispose: vi.fn(),
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    reveal: vi.fn(async () => undefined),
  })),
  executeCommand: vi.fn(),
  onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  openTerminalRun: vi.fn(),
  projectTreeArgs: undefined as unknown[] | undefined,
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  settingsProjects: ['/settings/repo'],
  tmuxPreflight: vi.fn(async () => ({ available: true })),
}));

vi.mock('vscode', () => ({
  ConfigurationTarget: {
    Global: 1,
  },
  commands: {
    executeCommand: vscodeState.executeCommand,
    registerCommand: vscodeState.registerCommand,
  },
  window: {
    createTreeView: vscodeState.createTreeView,
    onDidCloseTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    getConfiguration: () => ({
      get: <T>(_key: string, defaultValue: T) =>
        (vscodeState.settingsProjects as T | undefined) ?? defaultValue,
      update: vscodeState.configUpdate,
    }),
    onDidChangeWorkspaceFolders: vscodeState.onDidChangeWorkspaceFolders,
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
    constructor(...args: unknown[]) {
      vscodeState.projectTreeArgs = args;
    }

    refresh = vi.fn();
    getChildren = vi.fn(() => [{ projectPath: '/settings/repo' }]);
  },
}));

vi.mock('../src/tree/deckTreeDragAndDropController', () => ({
  DeckTreeDragAndDropController: class {},
}));

vi.mock('../src/terminal/tmuxPreflight', () => ({
  tmuxPreflight: vscodeState.tmuxPreflight,
}));

vi.mock('../src/terminal/tmuxCli', () => ({
  TmuxCli: class {},
}));

vi.mock('../src/terminal/addTerminalCommand', () => ({
  AddTerminalCommand: class {
    run = vscodeState.addTerminalRun;
  },
}));

vi.mock('../src/terminal/openTerminalCommand', () => ({
  OpenTerminalCommand: class {
    run = vscodeState.openTerminalRun;
  },
}));

vi.mock('../src/terminal/terminalSessionRegistry', () => ({
  TerminalSessionRegistry: class {},
}));

import * as vscode from 'vscode';
import { activate } from '../src/extension';

describe('activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.addProjectArgs = undefined;
    vscodeState.projectTreeArgs = undefined;
    vscodeState.settingsProjects = ['/settings/repo'];
    vscodeState.configUpdate.mockResolvedValue(undefined);
    vscodeState.tmuxPreflight.mockResolvedValue({ available: true });
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
      extensionPath: '/ext',
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

  it('sets tmux availability context and passes it to the tree', async () => {
    vscodeState.tmuxPreflight.mockResolvedValue({ available: false });
    const context = createContext();

    await activate(context as never);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'setContext',
      'deck.tmuxAvailable',
      false,
    );
    expect(vscodeState.projectTreeArgs?.at(-1)).toBe(false);
  });

  it('registers deck.addTerminal through AddTerminalCommand', async () => {
    const context = createContext();

    await activate(context as never);
    const addTerminalRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.addTerminal',
    );
    if (!addTerminalRegistration) throw new Error('missing deck.addTerminal registration');
    await addTerminalRegistration[1]({ worktree: { path: '/work/repo' } });

    expect(vscodeState.addTerminalRun).toHaveBeenCalledWith({ worktree: { path: '/work/repo' } });
  });

  it('registers deck.openTerminal and refreshes on workspace/view visibility events', async () => {
    const context = createContext();

    await activate(context as never);
    const openTerminalRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.openTerminal',
    );
    if (!openTerminalRegistration) throw new Error('missing deck.openTerminal registration');
    await openTerminalRegistration[1]({ terminal: { sessionName: 's', windowName: 'zsh' } });

    expect(vscodeState.openTerminalRun).toHaveBeenCalledWith({
      terminal: { sessionName: 's', windowName: 'zsh' },
    });
    expect(vscodeState.onDidChangeWorkspaceFolders).toHaveBeenCalledWith(expect.any(Function));
    expect(vscodeState.createTreeView.mock.results[0].value.onDidChangeVisibility).toHaveBeenCalledWith(
      expect.any(Function),
    );
  });
});
