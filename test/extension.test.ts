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
  closeTerminalRun: vi.fn(),
  closeTerminalArgs: undefined as unknown[] | undefined,
  onDidCloseTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  openTerminalRun: vi.fn(),
  projectTreeArgs: undefined as unknown[] | undefined,
  projectTreeInstances: [] as Array<{ refresh: ReturnType<typeof vi.fn>; getChildren: ReturnType<typeof vi.fn> }>,
  projectTreeRevealNode: undefined as ((node: unknown) => Promise<void> | void) | undefined,
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  settingsProjects: ['/settings/repo'],
  terminalSessionListCacheInstances: [] as Array<{ removeSession: ReturnType<typeof vi.fn> }>,
  terminalSessionRegistryInstances: [] as Array<{
    findSession: ReturnType<typeof vi.fn>;
    deleteSession: ReturnType<typeof vi.fn>;
  }>,
  tmuxInstances: [] as Array<{ killSession: ReturnType<typeof vi.fn> }>,
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
    onDidCloseTerminal: vscodeState.onDidCloseTerminal,
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
  TerminalSessionListCacheStore: class {
    removeSession = vi.fn(async () => undefined);

    constructor() {
      vscodeState.terminalSessionListCacheInstances.push(this);
    }
  },
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
    refresh = vi.fn();
    getChildren = vi.fn(() => [{ projectPath: '/settings/repo' }]);
    setRevealNode = vi.fn((revealNode: (node: unknown) => Promise<void> | void) => {
      vscodeState.projectTreeRevealNode = revealNode;
    });

    constructor(...args: unknown[]) {
      vscodeState.projectTreeArgs = args;
      vscodeState.projectTreeInstances.push(this);
    }
  },
}));

vi.mock('../src/tree/deckTreeDragAndDropController', () => ({
  DeckTreeDragAndDropController: class {},
}));

vi.mock('../src/terminal/tmuxPreflight', () => ({
  tmuxPreflight: vscodeState.tmuxPreflight,
}));

vi.mock('../src/terminal/tmuxCli', () => ({
  TmuxCli: class {
    killSession = vi.fn(async () => undefined);

    constructor() {
      vscodeState.tmuxInstances.push(this);
    }
  },
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
  CloseTerminalCommand: class {
    constructor(...args: unknown[]) {
      vscodeState.closeTerminalArgs = args;
    }

    run = vscodeState.closeTerminalRun;
  },
}));

vi.mock('../src/terminal/terminalSessionRegistry', () => ({
  TerminalSessionRegistry: class {
    findSession = vi.fn();
    deleteSession = vi.fn();

    constructor() {
      vscodeState.terminalSessionRegistryInstances.push(this);
    }
  },
}));

import * as vscode from 'vscode';
import { activate, openPendingTerminalForCurrentWorktree } from '../src/extension';
import { PendingTerminalOpenStore } from '../src/terminal/pendingTerminalOpenStore';

describe('activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.addProjectArgs = undefined;
    vscodeState.addTerminalArgs = undefined;
    vscodeState.closeTerminalArgs = undefined;
    vscodeState.projectTreeArgs = undefined;
    vscodeState.projectTreeInstances = [];
    vscodeState.projectTreeRevealNode = undefined;
    vscodeState.settingsProjects = ['/settings/repo'];
    vscodeState.terminalSessionListCacheInstances = [];
    vscodeState.terminalSessionRegistryInstances = [];
    vscodeState.tmuxInstances = [];
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

  it('wires active terminal row reveal without stealing focus or expanding', async () => {
    const context = createContext();

    await activate(context as never);
    const node = { id: 'terminal::wt-_work_repo__term-1' };
    await vscodeState.projectTreeRevealNode?.(node);

    expect(vscodeState.createTreeView.mock.results[0].value.reveal).toHaveBeenCalledWith(
      node,
      { select: true, focus: false, expand: false },
    );
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
    expect(vscodeState.closeTerminalArgs?.at(-1)).toBe(terminalSessionListCache);
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

  it('registers deck.killTerminal through CloseTerminalCommand', async () => {
    const context = createContext();

    await activate(context as never);
    const closeTerminalRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.killTerminal',
    );
    if (!closeTerminalRegistration) throw new Error('missing deck.killTerminal registration');
    await closeTerminalRegistration[1]({ terminal: { sessionName: 's', windowName: 'zsh' } });

    expect(vscodeState.closeTerminalRun).toHaveBeenCalledWith({
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

  it('kills a Deck-managed tmux session when VS Code closes its terminal', async () => {
    const context = createContext();

    await activate(context as never);
    const terminal = { show: vi.fn() };
    vscodeState.terminalSessionRegistryInstances[0].findSession.mockReturnValue('wt-_work_repo__term-1');
    await vscodeState.onDidCloseTerminal.mock.calls[0][0](terminal);

    expect(vscodeState.terminalSessionRegistryInstances[0].findSession).toHaveBeenCalledWith(terminal);
    expect(vscodeState.tmuxInstances[0].killSession).toHaveBeenCalledWith('wt-_work_repo__term-1');
    expect(vscodeState.terminalSessionListCacheInstances[0].removeSession).toHaveBeenCalledWith(
      'wt-_work_repo__term-1',
    );
    expect(vscodeState.terminalSessionRegistryInstances[0].deleteSession).toHaveBeenCalledWith(
      'wt-_work_repo__term-1',
    );
    expect(vscodeState.projectTreeInstances[0].refresh).toHaveBeenCalledOnce();
  });

  it('ignores VS Code close events for foreign terminals', async () => {
    const context = createContext();

    await activate(context as never);
    const terminal = { show: vi.fn() };
    vscodeState.terminalSessionRegistryInstances[0].findSession.mockReturnValue(undefined);
    await vscodeState.onDidCloseTerminal.mock.calls[0][0](terminal);

    expect(vscodeState.tmuxInstances[0].killSession).not.toHaveBeenCalled();
    expect(vscodeState.terminalSessionListCacheInstances[0].removeSession).not.toHaveBeenCalled();
    expect(vscodeState.terminalSessionRegistryInstances[0].deleteSession).not.toHaveBeenCalled();
  });
});
