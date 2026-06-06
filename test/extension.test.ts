import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  addProjectArgs: undefined as unknown[] | undefined,
  addTerminalArgs: undefined as unknown[] | undefined,
  addProjectRun: vi.fn(),
  addTerminalRun: vi.fn(),
  configUpdate: vi.fn(),
  createTreeView: vi.fn(() => ({
    dispose: vi.fn(),
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    reveal: vi.fn(async () => undefined),
  })),
  executeCommand: vi.fn(),
  killTerminalRun: vi.fn(),
  killTerminalArgs: undefined as unknown[] | undefined,
  onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  openTerminalRun: vi.fn(),
  projectTreeArgs: undefined as unknown[] | undefined,
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  settingsProjects: ['/settings/repo'],
  workspaceFolders: [{ uri: { fsPath: '/work/alpha-main' } }],
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
    onDidChangeActiveTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  },
  workspace: {
    getConfiguration: () => ({
      get: <T>(_key: string, defaultValue: T) =>
        (vscodeState.settingsProjects as T | undefined) ?? defaultValue,
      update: vscodeState.configUpdate,
    }),
    onDidChangeWorkspaceFolders: vscodeState.onDidChangeWorkspaceFolders,
    get workspaceFolders() {
      return vscodeState.workspaceFolders;
    },
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

vi.mock('../src/terminal/terminalSessionListCacheStore', () => ({
  TerminalSessionListCacheStore: class {},
  toCachedTerminalSessions: (
    worktreePath: string,
    sessions: Array<{ sessionName: string; windowName: string }>,
  ) =>
    sessions.map((session) => ({
      ...session,
      n: Number(session.sessionName.slice(`wt-${worktreePath.replace(/[:./]/g, '_')}__term-`.length)),
    })),
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
    constructor(...args: unknown[]) {
      vscodeState.addTerminalArgs = args;
    }

    run = vscodeState.addTerminalRun;
  },
}));

vi.mock('../src/terminal/openTerminalCommand', () => ({
  OpenTerminalCommand: class {
    run = vscodeState.openTerminalRun;
  },
}));

vi.mock('../src/terminal/killTerminalCommand', () => ({
  KillTerminalCommand: class {
    constructor(...args: unknown[]) {
      vscodeState.killTerminalArgs = args;
    }

    run = vscodeState.killTerminalRun;
  },
}));

vi.mock('../src/terminal/terminalSessionRegistry', () => ({
  TerminalSessionRegistry: class {},
}));

import * as vscode from 'vscode';
import { activate, openPendingTerminalForCurrentWorktree } from '../src/extension';
import { PendingTerminalOpenStore } from '../src/terminal/pendingTerminalOpenStore';

describe('activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.addProjectArgs = undefined;
    vscodeState.addTerminalArgs = undefined;
    vscodeState.killTerminalArgs = undefined;
    vscodeState.projectTreeArgs = undefined;
    vscodeState.settingsProjects = ['/settings/repo'];
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main' } }];
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
    expect(vscodeState.projectTreeArgs?.at(-3)).toBe(false);
  });

  it('hydrates terminal session list cache into the tree and terminal commands', async () => {
    const context = createContext();

    await activate(context as never);

    const terminalSessionListCache = vscodeState.projectTreeArgs?.at(-2);
    expect(terminalSessionListCache).toBeDefined();
    expect(vscodeState.addTerminalArgs?.at(-1)).toBe(terminalSessionListCache);
    expect(vscodeState.killTerminalArgs?.at(-1)).toBe(terminalSessionListCache);
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

  it('registers deck.killTerminal through KillTerminalCommand', async () => {
    const context = createContext();

    await activate(context as never);
    const killTerminalRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.killTerminal',
    );
    if (!killTerminalRegistration) throw new Error('missing deck.killTerminal registration');
    await killTerminalRegistration[1]({ terminal: { sessionName: 's', windowName: 'zsh' } });

    expect(vscodeState.killTerminalRun).toHaveBeenCalledWith({
      terminal: { sessionName: 's', windowName: 'zsh' },
    });
  });

  it('opens a consumed pending terminal for the current worktree after loading terminal cache', async () => {
    const pendingTerminalOpens = {
      consume: vi.fn(async () => 'wt-_work_alpha-main__term-1'),
    };
    const terminalSessionListCache = {
      set: vi.fn(async () => undefined),
    };
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      ]),
    };

    await openPendingTerminalForCurrentWorktree(
      pendingTerminalOpens,
      terminalSessionListCache,
      tmux,
    );

    expect(pendingTerminalOpens.consume).toHaveBeenCalledWith('/work/alpha-main');
    expect(terminalSessionListCache.set).toHaveBeenCalledWith('wt-_work_alpha-main__', [
      { sessionName: 'wt-_work_alpha-main__term-1', n: 1, windowName: 'zsh' },
    ]);
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'deck.openTerminal',
      expect.objectContaining({
        n: 1,
        worktreePath: '/work/alpha-main',
        terminal: expect.objectContaining({
          sessionName: 'wt-_work_alpha-main__term-1',
          windowName: 'zsh',
        }),
      }),
    );
  });

  it('does nothing when no pending terminal intent matches the current worktree', async () => {
    const pendingTerminalOpens = {
      consume: vi.fn(async () => undefined),
    };
    const terminalSessionListCache = {
      set: vi.fn(async () => undefined),
    };
    const tmux = {
      listSessions: vi.fn(async () => []),
    };

    await openPendingTerminalForCurrentWorktree(
      pendingTerminalOpens,
      terminalSessionListCache,
      tmux,
    );

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'deck.openTerminal',
      expect.anything(),
    );
    expect(tmux.listSessions).not.toHaveBeenCalled();
  });

  it('ignores expired pending terminal intents on activation', async () => {
    const values: Record<string, unknown> = {};
    const now = vi.fn(() => 1_000);
    const pendingTerminalOpens = new PendingTerminalOpenStore(
      {
        get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
        update: async (key: string, value: unknown) => {
          values[key] = value;
        },
      },
      now,
    );
    await pendingTerminalOpens.set('/work/alpha-main', 'wt-_work_alpha-main__term-1');
    now.mockReturnValue(61_001);
    const tmux = {
      listSessions: vi.fn(async () => []),
    };

    await openPendingTerminalForCurrentWorktree(
      pendingTerminalOpens,
      { set: vi.fn(async () => undefined) },
      tmux,
    );

    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith(
      'deck.openTerminal',
      expect.anything(),
    );
    expect(tmux.listSessions).not.toHaveBeenCalled();
  });
});
