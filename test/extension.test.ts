import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  addProjectArgs: undefined as unknown[] | undefined,
  addTerminalArgs: undefined as unknown[] | undefined,
  addProjectRun: vi.fn(),
  addTerminalRun: vi.fn(),
  configUpdate: vi.fn(),
  tabGroups: [] as Array<{ viewColumn: number; tabs: Array<{ input?: unknown }> }>,
  createTreeView: vi.fn(() => ({
    dispose: vi.fn(),
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    reveal: vi.fn(async () => undefined),
  })),
  executeCommand: vi.fn(),
  closeTerminalRun: vi.fn(),
  closeTerminalArgs: undefined as unknown[] | undefined,
  lifecycleOrder: [] as string[],
  onDidCloseTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeActiveTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  onDidOpenTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  openTerminalInNewWindowRun: vi.fn(),
  openTerminalRun: vi.fn(),
  openTerminalArgs: undefined as unknown[] | undefined,
  projectTreeArgs: undefined as unknown[] | undefined,
  projectTreeInstances: [] as Array<{ refresh: ReturnType<typeof vi.fn>; getChildren: ReturnType<typeof vi.fn> }>,
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  registerCustomEditorProvider: vi.fn(() => ({ dispose: vi.fn() })),
  settingsProjects: ['/settings/repo'],
  tmuxInstances: [] as Array<{
    killSession: ReturnType<typeof vi.fn>;
    listSessions: ReturnType<typeof vi.fn>;
  }>,
  workspaceFolders: [{ uri: { fsPath: '/work/alpha-main' } }],
  tmuxPreflight: vi.fn(async () => ({ available: true })),
}));

vi.mock('vscode', () => ({
  ConfigurationTarget: {
    Global: 1,
  },
  ViewColumn: { Active: -1 },
  ColorThemeKind: {
    Light: 1,
    Dark: 2,
    HighContrast: 3,
    HighContrastLight: 4,
  },
  commands: {
    executeCommand: vscodeState.executeCommand,
    registerCommand: vscodeState.registerCommand,
  },
  Uri: {
    joinPath: (base: unknown, ...paths: string[]) => ({ base, paths }),
    from(value: { scheme: string; authority: string; path: string; query: string }) {
      return value;
    },
  },
  window: {
    activeColorTheme: { kind: 2 },
    createTreeView: vscodeState.createTreeView,
    registerCustomEditorProvider: vscodeState.registerCustomEditorProvider,
    onDidCloseTerminal: vscodeState.onDidCloseTerminal,
    onDidChangeActiveTerminal: vscodeState.onDidChangeActiveTerminal,
    onDidOpenTerminal: vscodeState.onDidOpenTerminal,
    get tabGroups() {
      return { all: vscodeState.tabGroups };
    },
  },
  workspace: {
    getConfiguration: () => ({
      get: <T>(key: string, defaultValue: T) =>
        key === 'projects' ? ((vscodeState.settingsProjects as T | undefined) ?? defaultValue) : defaultValue,
      update: vscodeState.configUpdate,
    }),
    onDidChangeConfiguration: vscodeState.onDidChangeConfiguration,
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
    listSessions = vi.fn(async () => {
      vscodeState.lifecycleOrder.push('pending-list');
      return [{ sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' }];
    });

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
    constructor(...args: unknown[]) {
      vscodeState.openTerminalArgs = args;
    }

    run = vscodeState.openTerminalRun;
  },
}));

vi.mock('../src/terminal/openTerminalInNewWindowCommand', () => ({
  OpenTerminalInNewWindowCommand: class {
    run = vscodeState.openTerminalInNewWindowRun;
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

import * as vscode from 'vscode';
import { activate, openPendingTerminalForCurrentWorktree } from '../src/extension';
import { PendingTerminalOpenStore } from '../src/terminal/pendingTerminalOpenStore';

describe('activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.addProjectArgs = undefined;
    vscodeState.addTerminalArgs = undefined;
    vscodeState.closeTerminalArgs = undefined;
    vscodeState.lifecycleOrder = [];
    vscodeState.openTerminalArgs = undefined;
    vscodeState.projectTreeArgs = undefined;
    vscodeState.projectTreeInstances = [];
    vscodeState.settingsProjects = ['/settings/repo'];
    vscodeState.tmuxInstances = [];
    vscodeState.tabGroups = [];
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
      workspaceState: {
        get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
        update: vi.fn(async (key: string, value: unknown) => {
          values[key] = value;
        }),
      },
      subscriptions: [] as Array<{ dispose(): void }>,
      extensionPath: '/ext',
      extensionUri: { fsPath: '/ext' },
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

  it('consumes pending intents and registers no VS Code terminal listeners', async () => {
    const context = createContext();
    context.values['deck.pendingTerminalOpen'] = {
      schemaVersion: 1,
      entries: {
        '/work/alpha-main': {
          sessionName: 'wt-_work_alpha-main__term-1',
          createdAt: Date.now(),
        },
      },
    };
    await activate(context as never);

    expect(vscodeState.onDidOpenTerminal).not.toHaveBeenCalled();
    expect(vscodeState.onDidCloseTerminal).not.toHaveBeenCalled();
    expect(vscodeState.onDidChangeActiveTerminal).not.toHaveBeenCalled();
    // Tab restoration is now VS Code's native custom-editor restore — Deck no
    // longer replays a snapshot, so only the pending-intent step runs here.
    expect(vscodeState.lifecycleOrder).toEqual(['pending-list']);
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

  it('registers deck.terminal.find', async () => {
    const context = createContext();

    await activate(context as never);

    expect(vscodeState.registerCommand).toHaveBeenCalledWith(
      'deck.terminal.find',
      expect.any(Function),
    );
  });

  it('kills tmux and refreshes when a Deck custom-editor tab is disposed', async () => {
    const context = createContext();
    let disposePanel: (() => void) | undefined;
    const panel = {
      webview: {
        options: {},
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: unknown) => uri,
        postMessage: vi.fn(async () => true),
        onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
      },
      onDidDispose: vi.fn((handler: () => void) => {
        disposePanel = handler;
        return { dispose: vi.fn() };
      }),
    };

    await activate(context as never);
    const provider = vscodeState.registerCustomEditorProvider.mock.calls[0][1] as {
      openCustomDocument(uri: unknown): unknown;
      resolveCustomEditor(document: unknown, panel: unknown): void;
    };
    const document = provider.openCustomDocument({
      scheme: 'deck-terminal',
      path: '/wt-_work_repo__term-1',
      query: 'cwd=%2Fwork%2Frepo',
    });
    provider.resolveCustomEditor(document, panel);
    disposePanel?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(vscodeState.tmuxInstances[0].killSession).toHaveBeenCalledWith('wt-_work_repo__term-1');
    expect(vscodeState.projectTreeInstances[0].refresh).toHaveBeenCalledOnce();
  });

  it('registers deck.openTerminalInNewWindow through OpenTerminalInNewWindowCommand', async () => {
    const context = createContext();

    await activate(context as never);
    const openTerminalInNewWindowRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.openTerminalInNewWindow',
    );
    if (!openTerminalInNewWindowRegistration) {
      throw new Error('missing deck.openTerminalInNewWindow registration');
    }
    await openTerminalInNewWindowRegistration[1]({
      terminal: { sessionName: 's', windowName: 'zsh' },
      worktreePath: '/work/repo',
    });

    expect(vscodeState.openTerminalInNewWindowRun).toHaveBeenCalledWith({
      terminal: { sessionName: 's', windowName: 'zsh' },
      worktreePath: '/work/repo',
    });
  });

  it('consumes a pending terminal for the current worktree and opens it as a Deck custom editor', async () => {
    const pendingTerminalOpens = {
      consume: vi.fn(async () => 'wt-_work_alpha-main__term-1'),
    };
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      ]),
    };

    await openPendingTerminalForCurrentWorktree(
      pendingTerminalOpens,
      tmux,
    );

    expect(pendingTerminalOpens.consume).toHaveBeenCalledWith('/work/alpha-main');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      {
        scheme: 'deck-terminal',
        authority: 'session',
        path: '/wt-_work_alpha-main__term-1',
        query: 'cwd=%2Fwork%2Falpha-main',
      },
      'deck.terminal',
      { viewColumn: -1 },
    );
  });

  it('reveals an already-restored pending terminal in its own group, not the active one', async () => {
    // VS Code natively restored this terminal in editor group 2 on switch-back.
    vscodeState.tabGroups = [
      { viewColumn: 1, tabs: [] },
      {
        viewColumn: 2,
        tabs: [
          {
            input: {
              viewType: 'deck.terminal',
              uri: {
                scheme: 'deck-terminal',
                path: '/wt-_work_alpha-main__term-1',
                query: 'cwd=%2Fwork%2Falpha-main',
              },
            },
          },
        ],
      },
    ];
    const pendingTerminalOpens = { consume: vi.fn(async () => 'wt-_work_alpha-main__term-1') };
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      ]),
    };

    await openPendingTerminalForCurrentWorktree(pendingTerminalOpens, tmux);

    // Reveal in its restored group (2), not ViewColumn.Active (-1), which would
    // yank the tab to the last-focused group.
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      expect.anything(),
      'deck.terminal',
      { viewColumn: 2 },
    );
  });

  it('does nothing when no pending terminal intent matches the current worktree', async () => {
    const pendingTerminalOpens = {
      consume: vi.fn(async () => undefined),
    };
    const tmux = {
      listSessions: vi.fn(async () => []),
    };

    await openPendingTerminalForCurrentWorktree(
      pendingTerminalOpens,
      tmux,
    );

    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(tmux.listSessions).not.toHaveBeenCalled();
    expect(pendingTerminalOpens.consume).toHaveBeenCalledWith('/work/alpha-main');
  });

  it('consumes the pending intent without opening when the target session has vanished', async () => {
    const pendingTerminalOpens = {
      consume: vi.fn(async () => 'wt-_work_alpha-main__term-1'),
    };
    const tmux = {
      listSessions: vi.fn(async () => []),
    };

    await openPendingTerminalForCurrentWorktree(
      pendingTerminalOpens,
      tmux,
    );

    expect(pendingTerminalOpens.consume).toHaveBeenCalledWith('/work/alpha-main');
    expect(tmux.listSessions).toHaveBeenCalledWith('wt-_work_alpha-main__term-');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
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
      tmux,
    );

    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(tmux.listSessions).not.toHaveBeenCalled();
  });

});
