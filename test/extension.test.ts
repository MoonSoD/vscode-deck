import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const tempRoots: string[] = [];

const vscodeState = vi.hoisted(() => ({
  addRepositoryArgs: undefined as unknown[] | undefined,
  addTerminalArgs: undefined as unknown[] | undefined,
  addRepositoryRun: vi.fn(),
  addTerminalRun: vi.fn(),
  agentDetectionArgs: undefined as unknown[] | undefined,
  agentSetupPromptArgs: undefined as unknown[] | undefined,
  agentSetupPromptRun: vi.fn(),
  agentSetupPromptUninstall: vi.fn(),
  agentStatusStoreArgs: undefined as unknown[] | undefined,
  agentStatusStoreMarkRead: vi.fn(async () => undefined),
  agentStatusStoreChange: undefined as (() => void) | undefined,
  agentStatusStoreEntries: [] as Array<[
    string,
    {
      status: 'inProgress' | 'needsInput' | 'completed' | 'failed';
      statusAt: number;
      message?: string;
    },
  ]>,
  agentStatusStorePrune: vi.fn(async () => undefined),
  agentStatusStoreStart: vi.fn(async () => ({ dispose: vi.fn() })),
  agentStatusStoreChangeListeners: [] as Array<() => void>,
  agentStatusStoreChangeListener: undefined as (() => void) | undefined,
  hookInstallerArgs: undefined as unknown[] | undefined,
  hookInstallerReconcile: vi.fn(async () => [] as Array<{ agent: 'claude' | 'codex'; configPath: string }>),
  hookInstallerRemove: vi.fn(),
  configUpdate: vi.fn(),
  externalWatchDisposables: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
  tabGroups: [] as Array<{ viewColumn: number; tabs: Array<{ input?: unknown }> }>,
  createTreeView: vi.fn(() => ({
    dispose: vi.fn(),
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    reveal: vi.fn(async () => undefined),
    get selection() {
      return vscodeState.treeViewSelection;
    },
  })),
  executeCommand: vi.fn(),
  terminalRemovalRun: vi.fn(),
  terminalRemovalArgs: undefined as unknown[] | undefined,
  lifecycleOrder: [] as string[],
  activeTab: undefined as { input?: unknown } | undefined,
  onDidCloseTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeActiveTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeTabGroups: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
  onDidChangeWorkspaceFolders: vi.fn(() => ({ dispose: vi.fn() })),
  onDidOpenTerminal: vi.fn(() => ({ dispose: vi.fn() })),
  openTerminalInNewWindowRun: vi.fn(),
  openTerminalRun: vi.fn(),
  openTerminalArgs: undefined as unknown[] | undefined,
  repositoryTreeArgs: undefined as unknown[] | undefined,
  repositoryTreeInstances: [] as Array<{
    findTerminal: ReturnType<typeof vi.fn>;
    findTerminalBySessionName: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
    getChildren: ReturnType<typeof vi.fn>;
  }>,
  registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  registerCustomEditorProvider: vi.fn(() => ({ dispose: vi.fn() })),
  removeWorktreeArgs: undefined as unknown[] | undefined,
  settingsRepositories: ['/settings/repo'],
  settingsAgentResumeTemplates: {} as Record<string, string | undefined>,
  settingsAgentStatusNotifications: {} as {
    notifyOnNeedsInput?: string;
    notifyOnCompleted?: string;
  },
  settingsDeckTmux: {} as {
    automaticRenameFormat?: string;
  },
  tmuxServerRunning: false,
  tmuxInstances: [] as Array<{
    configPath: string;
    isServerRunning: ReturnType<typeof vi.fn>;
    killSession: ReturnType<typeof vi.fn>;
    listSessions: ReturnType<typeof vi.fn>;
    setOption: ReturnType<typeof vi.fn>;
    unsetOption: ReturnType<typeof vi.fn>;
  }>,
  terminalSnapshotRuntimeInstances: [] as Array<{
    tmux: unknown;
    saveScriptPath: () => string;
    beforeRestore: () => Promise<void>;
    save: ReturnType<typeof vi.fn>;
    restoreOnActivation: ReturnType<typeof vi.fn>;
    startPeriodicSave: ReturnType<typeof vi.fn>;
    periodicSave: { dispose: ReturnType<typeof vi.fn> };
  }>,
  watchGitCommonDir: vi.fn(),
  workspaceFolders: [{ uri: { fsPath: '/work/alpha-main' } }],
  tmuxPreflight: vi.fn(async () => ({ available: true })),
  configListeners: [] as Array<(event: { affectsConfiguration(section: string): boolean }) => unknown>,
  rewriteTerminalSnapshotAgentSessions: vi.fn(async () => undefined),
  showWarningMessage: vi.fn(),
  showInformationMessage: vi.fn(),
  showTextDocument: vi.fn(),
  workspaceFsStat: vi.fn(async () => ({})),
  treeViewSelection: [] as unknown[],
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
    file: (path: string) => ({ fsPath: path }),
    joinPath: (base: unknown, ...paths: string[]) => ({ base, paths }),
    from(value: { scheme: string; authority: string; path: string; query: string }) {
      return value;
    },
  },
  window: {
    activeColorTheme: { kind: 2 },
    createTreeView: vscodeState.createTreeView,
    registerCustomEditorProvider: vscodeState.registerCustomEditorProvider,
    showWarningMessage: vscodeState.showWarningMessage,
    showInformationMessage: vscodeState.showInformationMessage,
    showTextDocument: vscodeState.showTextDocument,
    state: {
      get focused() {
        return true;
      },
    },
    onDidCloseTerminal: vscodeState.onDidCloseTerminal,
    onDidChangeActiveTerminal: vscodeState.onDidChangeActiveTerminal,
    onDidOpenTerminal: vscodeState.onDidOpenTerminal,
    get tabGroups() {
      return {
        all: vscodeState.tabGroups,
        activeTabGroup: { activeTab: vscodeState.activeTab },
        onDidChangeTabGroups: vscodeState.onDidChangeTabGroups,
        onDidChangeTabs: vscodeState.onDidChangeTabs,
      };
    },
  },
  workspace: {
    getConfiguration: (section?: string) => ({
      get: <T>(key: string, defaultValue?: T) => {
        if (section === 'deck.tmux' && key === 'automaticRenameFormat') {
          return (vscodeState.settingsDeckTmux.automaticRenameFormat as T | undefined) ?? defaultValue;
        }
        if (key === 'repositories') return (vscodeState.settingsRepositories as T | undefined) ?? defaultValue;
        if (key === 'agentResumeTemplates.claude') {
          return (vscodeState.settingsAgentResumeTemplates.claude as T | undefined) ?? defaultValue;
        }
        if (key === 'agentResumeTemplates.codex') {
          return (vscodeState.settingsAgentResumeTemplates.codex as T | undefined) ?? defaultValue;
        }
        if (key === 'notifyOnNeedsInput') {
          return (vscodeState.settingsAgentStatusNotifications.notifyOnNeedsInput as T | undefined) ?? defaultValue;
        }
        if (key === 'notifyOnCompleted') {
          return (vscodeState.settingsAgentStatusNotifications.notifyOnCompleted as T | undefined) ?? defaultValue;
        }
        return defaultValue;
      },
      update: vscodeState.configUpdate,
    }),
    fs: {
      stat: vscodeState.workspaceFsStat,
    },
    onDidChangeConfiguration: (listener: (event: { affectsConfiguration(section: string): boolean }) => unknown) => {
      vscodeState.onDidChangeConfiguration(listener);
      vscodeState.configListeners.push(listener);
      return { dispose: vi.fn() };
    },
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

vi.mock('../src/repository/repositoryCommonDirCache', () => ({
  RepositoryCommonDirCache: class {},
  resolveCommonDirSafe: vi.fn(async () => null),
}));

vi.mock('../src/repository/vscodeExternalGitWatch', () => ({
  watchGitCommonDir: vscodeState.watchGitCommonDir,
}));

vi.mock('../src/repository/addRepositoryCommand', () => ({
  AddRepositoryCommand: class {
    constructor(...args: unknown[]) {
      vscodeState.addRepositoryArgs = args;
    }

    run = vscodeState.addRepositoryRun;
  },
  VsCodeRepositoryFolderPicker: class {},
}));

vi.mock('../src/switch/worktreeSwitcher', () => ({
  WorktreeSwitcher: class {},
}));


vi.mock('../src/worktree/addWorktreeCommand', () => ({
  AddWorktreeCommand: class {},
}));

vi.mock('../src/worktree/worktreeRemovalCommand', () => ({
  WorktreeRemovalCommand: class {
    constructor(...args: unknown[]) {
      vscodeState.removeWorktreeArgs = args;
    }
  },
}));

vi.mock('../src/repository/repositoryRemovalCommand', () => ({
  RepositoryRemovalCommand: class {},
}));

vi.mock('../src/tree/repositoryTree', () => ({
  RepositoryTreeProvider: class {
    findTerminal = vi.fn();
    findTerminalBySessionName = vi.fn();
    refresh = vi.fn();
    getChildren = vi.fn(() => [{ repositoryPath: '/settings/repo' }]);

    constructor(...args: unknown[]) {
      vscodeState.repositoryTreeArgs = args;
      vscodeState.repositoryTreeInstances.push(this);
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
    configPath: string;
    killSession = vi.fn(async () => undefined);
    windowName = vi.fn(async () => 'zsh');
    isServerRunning = vi.fn(async () => vscodeState.tmuxServerRunning);
    listSessions = vi.fn(async () => {
      vscodeState.lifecycleOrder.push('pending-list');
      return [{ sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' }];
    });
    setOption = vi.fn(async () => undefined);
    unsetOption = vi.fn(async () => undefined);

    constructor(configPath: string) {
      this.configPath = configPath;
      vscodeState.tmuxInstances.push(this);
    }
  },
}));

vi.mock('../src/terminal/terminalSnapshotRuntime', () => ({
  TerminalSnapshotRuntime: class {
    save = vi.fn(async () => undefined);
    restoreOnActivation = vi.fn(async () => ({ restored: true }));
    periodicSave = { dispose: vi.fn() };
    startPeriodicSave = vi.fn(() => this.periodicSave);

    constructor(
      public readonly tmux: unknown,
      public readonly saveScriptPath: () => string,
      public readonly restoreScriptPath: () => string,
      public readonly anchorCwd: () => string,
      public readonly beforeRestore: () => Promise<void>,
    ) {
      vscodeState.terminalSnapshotRuntimeInstances.push(this);
    }
  },
}));

vi.mock('../src/agent/terminalSnapshotAgentSessions', () => ({
  rewriteTerminalSnapshotAgentSessions: vscodeState.rewriteTerminalSnapshotAgentSessions,
}));

vi.mock('../src/agent/agentStatusStore', () => ({
  AgentStatusStore: class {
    get = vi.fn();
    markRead = vscodeState.agentStatusStoreMarkRead;
    entries = vi.fn(() => vscodeState.agentStatusStoreEntries.values());
    onDidChange = vi.fn((listener: () => void) => {
      vscodeState.agentStatusStoreChangeListeners.push(listener);
      if (!vscodeState.agentStatusStoreChangeListener) {
        vscodeState.agentStatusStoreChangeListener = listener;
      } else if (!vscodeState.agentStatusStoreChange) {
        vscodeState.agentStatusStoreChange = listener;
      }
      return { dispose: vi.fn() };
    });
    prune = vscodeState.agentStatusStorePrune;
    start = vscodeState.agentStatusStoreStart;

    constructor(...args: unknown[]) {
      vscodeState.agentStatusStoreArgs = args;
    }
  },
}));

vi.mock('../src/agent/hookInstaller', () => ({
  HookInstaller: class {
    constructor(...args: unknown[]) {
      vscodeState.hookInstallerArgs = args;
    }

    remove = vscodeState.hookInstallerRemove;
    reconcileInstalledHooks = vscodeState.hookInstallerReconcile;
  },
}));

vi.mock('../src/agent/agentDetection', () => ({
  AgentDetection: class {
    constructor(...args: unknown[]) {
      vscodeState.agentDetectionArgs = args;
    }
  },
}));

vi.mock('../src/agent/agentSetupPrompt', () => ({
  AGENT_HOOK_SETUP_DISMISSED_KEY: 'deck.agentHooks.setup.dismissed',
  AgentSetupPrompt: class {
    constructor(...args: unknown[]) {
      vscodeState.agentSetupPromptArgs = args;
    }

    run = vscodeState.agentSetupPromptRun;
    uninstall = vscodeState.agentSetupPromptUninstall;
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
  TerminalRemovalCommand: class {
    constructor(...args: unknown[]) {
      vscodeState.terminalRemovalArgs = args;
    }

    run = vscodeState.terminalRemovalRun;
  },
}));

import * as vscode from 'vscode';
import { activate, deactivate, openPendingTerminalForCurrentWorktree } from '../src/extension';
import { resolveCommonDirSafe } from '../src/repository/repositoryCommonDirCache';
import { PendingTerminalOpenStore } from '../src/terminal/pendingTerminalOpenStore';

describe('activate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.addRepositoryArgs = undefined;
    vscodeState.addTerminalArgs = undefined;
    vscodeState.agentDetectionArgs = undefined;
    vscodeState.agentSetupPromptArgs = undefined;
    vscodeState.agentStatusStoreChangeListener = undefined;
    vscodeState.agentStatusStoreMarkRead.mockResolvedValue(undefined);
    vscodeState.agentSetupPromptRun.mockResolvedValue(undefined);
    vscodeState.agentSetupPromptUninstall.mockResolvedValue(undefined);
    vscodeState.agentStatusStoreArgs = undefined;
    vscodeState.agentStatusStoreChange = undefined;
    vscodeState.agentStatusStoreChangeListeners = [];
    vscodeState.agentStatusStoreEntries = [];
    vscodeState.agentStatusStorePrune.mockResolvedValue(undefined);
    vscodeState.agentStatusStoreStart.mockResolvedValue({ dispose: vi.fn() });
    vscodeState.hookInstallerArgs = undefined;
    vscodeState.hookInstallerReconcile.mockResolvedValue([]);
    vscodeState.hookInstallerReconcile.mockClear();
    vscodeState.hookInstallerRemove.mockResolvedValue([]);
    vscodeState.externalWatchDisposables = [];
    vscodeState.terminalRemovalArgs = undefined;
    vscodeState.activeTab = undefined;
    vscodeState.lifecycleOrder = [];
    vscodeState.openTerminalArgs = undefined;
    vscodeState.repositoryTreeArgs = undefined;
    vscodeState.repositoryTreeInstances = [];
    vscodeState.removeWorktreeArgs = undefined;
    vscodeState.settingsRepositories = ['/settings/repo'];
    vscodeState.settingsAgentResumeTemplates = {};
    vscodeState.settingsAgentStatusNotifications = {};
    vscodeState.settingsDeckTmux = {};
    vscodeState.tmuxServerRunning = false;
    vscodeState.tmuxInstances = [];
    vscodeState.terminalSnapshotRuntimeInstances = [];
    vscodeState.rewriteTerminalSnapshotAgentSessions.mockClear();
    vscodeState.watchGitCommonDir.mockImplementation(() => {
      const disposable = { dispose: vi.fn() };
      vscodeState.externalWatchDisposables.push(disposable);
      return disposable;
    });
    vscodeState.onDidChangeTabGroups.mockClear();
    vscodeState.onDidChangeTabs.mockClear();
    vscodeState.tabGroups = [];
    vscodeState.treeViewSelection = [];
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main' } }];
    vscodeState.configUpdate.mockResolvedValue(undefined);
    vscodeState.tmuxPreflight.mockResolvedValue({ available: true });
    vscodeState.configListeners = [];
    vscodeState.showWarningMessage.mockClear();
    vscodeState.showInformationMessage.mockReset();
    vscodeState.showTextDocument.mockClear();
    vscodeState.workspaceFsStat.mockResolvedValue({});
    vscodeState.workspaceFsStat.mockClear();
    vi.mocked(resolveCommonDirSafe).mockResolvedValue(null);
  });

  afterEach(() => {
    delete process.env.XDG_DATA_HOME;
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  function createContext(globalRepositories: string[] = []) {
    const values: Record<string, unknown> = { 'deck.repositoryRegistry': globalRepositories };
    const globalStoragePath = mkdtempSync(join(tmpdir(), 'deck-test-global-'));
    tempRoots.push(globalStoragePath);
    const xdgDataHome = mkdtempSync(join(tmpdir(), 'deck-test-xdg-'));
    tempRoots.push(xdgDataHome);
    process.env.XDG_DATA_HOME = xdgDataHome;
    return {
      xdgDataHome,
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
      extensionPath: process.cwd(),
      extensionUri: { fsPath: process.cwd() },
      globalStorageUri: { fsPath: globalStoragePath },
      values,
    };
  }

  it('creates the Repositories tree view with drag-and-drop enabled', async () => {
    const context = createContext();

    await activate(context as never);

    expect(vscode.window.createTreeView).toHaveBeenCalledWith(
      'deck.repositories',
      expect.objectContaining({
        canSelectMany: false,
        dragAndDropController: expect.any(Object),
        treeDataProvider: expect.any(Object),
      }),
    );
    expect(context.subscriptions[0]).toBe(vscodeState.createTreeView.mock.results[0].value);
  });

  it('updates the Deck view badge from needs-input agent statuses', async () => {
    vscodeState.agentStatusStoreEntries = [
      ['wt-_work_alpha-main__term-1', { status: 'needsInput', statusAt: 1710000000 }],
      ['wt-_work_alpha-main__term-2', { status: 'completed', statusAt: 1710000001 }],
    ];
    const context = createContext();

    await activate(context as never);
    const treeView = vscodeState.createTreeView.mock.results[0].value as { badge?: unknown };

    expect(treeView.badge).toEqual({
      value: 1,
      tooltip: '1 agent needs input',
    });

    vscodeState.agentStatusStoreEntries = [
      ['wt-_work_alpha-main__term-1', { status: 'needsInput', statusAt: 1710000002 }],
      ['wt-_work_beta-main__term-1', { status: 'needsInput', statusAt: 1710000003 }],
    ];
    vscodeState.agentStatusStoreChange?.();

    expect(treeView.badge).toEqual({
      value: 2,
      tooltip: '2 agents need input',
    });

    vscodeState.agentStatusStoreEntries = [
      ['wt-_work_alpha-main__term-1', { status: 'completed', statusAt: 1710000004 }],
    ];
    vscodeState.agentStatusStoreChange?.();

    expect(treeView.badge).toBeUndefined();
  });

  it('uses RepositoryRegistryStore without migrating legacy settings', async () => {
    const context = createContext(['/global/repo']);

    await activate(context as never);

    expect(context.values['deck.repositoryRegistry']).toEqual(['/global/repo']);
    expect(vscodeState.configUpdate).not.toHaveBeenCalled();
  });

  it('registers deck.addRepository through AddRepositoryCommand', async () => {
    const context = createContext();

    await activate(context as never);
    const addRepositoryRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.addRepository',
    );
    if (!addRepositoryRegistration) throw new Error('missing deck.addRepository registration');
    await addRepositoryRegistration[1]();

    expect(vscodeState.addRepositoryRun).toHaveBeenCalledOnce();
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
    expect(vscodeState.repositoryTreeArgs?.[6]).toBe(false);
    expect(vscodeState.terminalSnapshotRuntimeInstances).toEqual([]);
  });

  it('writes generated deck.conf to the machine-global Deck dir and gives tmux that path', async () => {
    const context = createContext();

    await activate(context as never);

    // Both the conf and the snapshot live in one space-free, machine-global
    // Deck dir — NOT globalStorage (per-install, and macOS's "Application
    // Support" space breaks tmux-resurrect's restore.sh).
    const deckDir = join(context.xdgDataHome, 'deck');
    const generatedConf = join(deckDir, 'deck.conf');
    const resurrectDir = join(deckDir, 'resurrect');
    const generatedConfContents = readFileSync(generatedConf, 'utf8');
    expect(existsSync(resurrectDir)).toBe(true);
    expect(generatedConfContents).toContain(
      `set -g @resurrect-dir '${resurrectDir}'`,
    );
    // Regression guard: resurrect's restore.sh restores nothing when
    // @resurrect-dir contains a space, and globalStorage is spaced on macOS.
    expect(resurrectDir).not.toMatch(/\s/);
    expect(resurrectDir.startsWith(context.globalStorageUri.fsPath)).toBe(false);
    expect(generatedConfContents).toContain(
      `run-shell '${join(process.cwd(), 'resources', 'plugins', 'tmux-resurrect', 'resurrect.tmux')}'`,
    );
    expect(vscodeState.tmuxInstances[0].configPath).toBe(generatedConf);
  });

  it('writes and live-applies the automatic-rename-format when the DeckSocket is running', async () => {
    vscodeState.tmuxServerRunning = true;
    vscodeState.settingsDeckTmux = {
      automaticRenameFormat: '#{pane_current_command}:#{pane_current_path}',
    };
    const context = createContext();

    await activate(context as never);

    const deckDir = join(context.xdgDataHome, 'deck');
    const generatedConf = join(deckDir, 'deck.conf');
    expect(readFileSync(generatedConf, 'utf8')).toContain(
      "set -g automatic-rename-format '#{pane_current_command}:#{pane_current_path}'\nset -g history-limit 5000",
    );
    expect(vscodeState.tmuxInstances[0].setOption).toHaveBeenCalledWith(
      'automatic-rename-format',
      '#{pane_current_command}:#{pane_current_path}',
    );
  });

  it('rewrites deck.conf and unsets automatic rename format when the tmux setting is cleared', async () => {
    vscodeState.tmuxServerRunning = true;
    vscodeState.settingsDeckTmux = {
      automaticRenameFormat: '#{pane_current_command}',
    };
    const context = createContext();

    await activate(context as never);
    vscodeState.settingsDeckTmux.automaticRenameFormat = '';
    await Promise.all(vscodeState.configListeners.map((listener) => listener({
      affectsConfiguration: (section) => section === 'deck.tmux',
    })));

    const generatedConf = join(context.xdgDataHome, 'deck', 'deck.conf');
    expect(readFileSync(generatedConf, 'utf8')).not.toContain('automatic-rename-format');
    expect(vscodeState.tmuxInstances[0].unsetOption).toHaveBeenCalledWith('automatic-rename-format');
  });

  it('starts TerminalSnapshot periodic saves and fires one best-effort save on deactivate', async () => {
    const context = createContext();

    await activate(context as never);

    const runtime = vscodeState.terminalSnapshotRuntimeInstances[0];
    expect(runtime.tmux).toBe(vscodeState.tmuxInstances[0]);
    expect(runtime.saveScriptPath()).toBe(
      join(process.cwd(), 'resources', 'plugins', 'tmux-resurrect', 'scripts', 'save.sh'),
    );
    expect(runtime.startPeriodicSave).toHaveBeenCalledWith(5 * 60 * 1000);
    expect(context.subscriptions).toContain(runtime.periodicSave);

    deactivate();
    deactivate();

    expect(runtime.save).toHaveBeenCalledOnce();
  });

  it('restores the TerminalSnapshot during activation when tmux is available', async () => {
    const context = createContext();

    await activate(context as never);

    const runtime = vscodeState.terminalSnapshotRuntimeInstances[0];
    expect(runtime.restoreOnActivation).toHaveBeenCalledOnce();
  });

  it('uses agent resume template settings when rewriting the TerminalSnapshot', async () => {
    vscodeState.settingsAgentResumeTemplates.codex = 'codex --dangerously-bypass-approvals-and-sandbox resume {id}';
    const context = createContext();

    await activate(context as never);
    const runtime = vscodeState.terminalSnapshotRuntimeInstances[0];
    await runtime.beforeRestore();

    const rewriter = vscodeState.rewriteTerminalSnapshotAgentSessions.mock.calls[0]?.[2];
    if (!rewriter || typeof rewriter !== 'object' || !('rewrite' in rewriter)) {
      throw new Error('missing SnapshotRewriter');
    }

    const rewritten = (rewriter as { rewrite(snapshotText: string, sidecars: ReadonlyMap<string, unknown>): string })
      .rewrite(
        'pane\twt-_work_repo__term-1\t0\t1\t:*\t0\t%0\t:/work/repo\t1\tcodex\t:codex',
        new Map([
          ['wt-_work_repo__term-1', { agent: 'codex', session_id: 'codex-123' }],
        ]),
      );

    expect(rewritten.split('\t')[10]).toBe(
      ':codex --dangerously-bypass-approvals-and-sandbox resume codex-123',
    );
  });

  it('syncs one ExternalGitWatch per registered Repository common dir', async () => {
    const context = createContext(['/work/alpha-main', '/work/alpha-linked']);
    vi.mocked(resolveCommonDirSafe).mockResolvedValue('/git/alpha');

    await activate(context as never);
    await Promise.resolve();

    expect(vscodeState.watchGitCommonDir).toHaveBeenCalledOnce();
    expect(vscodeState.watchGitCommonDir).toHaveBeenCalledWith('/git/alpha', expect.any(Function));

    vi.mocked(resolveCommonDirSafe).mockImplementation(async (_cache, repositoryPath) =>
      repositoryPath === '/work/alpha-main' ? '/git/alpha' : '/git/beta',
    );
    const refreshRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.refresh',
    );
    if (!refreshRegistration) throw new Error('missing deck.refresh registration');
    refreshRegistration[1]();

    await vi.waitFor(() => expect(vscodeState.watchGitCommonDir).toHaveBeenCalledTimes(2));
    expect(vscodeState.watchGitCommonDir).toHaveBeenLastCalledWith('/git/beta', expect.any(Function));
    expect(vscodeState.externalWatchDisposables[0].dispose).not.toHaveBeenCalled();
  });

  it('shares pending WorktreeRemoval state between the command and tree', async () => {
    const context = createContext();

    await activate(context as never);

    expect(vscodeState.repositoryTreeArgs?.[7]).toBeInstanceOf(Set);
    expect(vscodeState.removeWorktreeArgs?.[6]).toBe(vscodeState.repositoryTreeArgs?.[7]);
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
    // longer replays a snapshot. Two list-sessions run here: the pending-intent
    // open, then agent sidecar/status pruning share one live-session list.
    expect(vscodeState.lifecycleOrder).toEqual(['pending-list', 'pending-list']);
    expect(vscodeState.agentStatusStorePrune).toHaveBeenCalledWith(
      new Set(['wt-_work_alpha-main__term-1']),
    );
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

  it('registers deck.installAgentHooks through the setup prompt', async () => {
    const context = createContext();

    await activate(context as never);
    expect(vscodeState.agentSetupPromptRun).toHaveBeenCalledWith();
    const registration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.installAgentHooks',
    );
    if (!registration) throw new Error('missing deck.installAgentHooks registration');
    await registration[1]();

    expect(vscodeState.agentSetupPromptRun).toHaveBeenCalledWith({ explicit: true });
  });

  it('notifies after activation reconciles installed agent hooks and reviews the backup diff', async () => {
    const context = createContext();
    vscodeState.hookInstallerReconcile.mockResolvedValue([
      { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
    ]);
    vscodeState.showInformationMessage.mockResolvedValue('Review Changes');

    await activate(context as never);

    await vi.waitFor(() => {
      expect(vscodeState.hookInstallerReconcile).toHaveBeenCalledOnce();
      expect(vscodeState.showInformationMessage).toHaveBeenCalledWith(
        'Deck updated its Claude Code hooks for this Deck version',
        'Review Changes',
      );
    });
    await vi.waitFor(() => {
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        { fsPath: '/home/me/.claude/settings.json.deck.bak' },
        { fsPath: '/home/me/.claude/settings.json' },
        'Deck Claude hooks (before ↔ after)',
        { preview: false },
      );
    });
  });

  it('opens one persistent review tab per agent when both reconcile', async () => {
    const context = createContext();
    vscodeState.hookInstallerReconcile.mockResolvedValue([
      { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
      { agent: 'codex', configPath: '/home/me/.codex/hooks.json' },
    ]);
    vscodeState.showInformationMessage.mockResolvedValue('Review Changes');

    await activate(context as never);

    await vi.waitFor(() => {
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        { fsPath: '/home/me/.claude/settings.json.deck.bak' },
        { fsPath: '/home/me/.claude/settings.json' },
        'Deck Claude hooks (before ↔ after)',
        { preview: false },
      );
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
        'vscode.diff',
        { fsPath: '/home/me/.codex/hooks.json.deck.bak' },
        { fsPath: '/home/me/.codex/hooks.json' },
        'Deck Codex hooks (before ↔ after)',
        { preview: false },
      );
    });
  });

  it('shows upgrade toasts for every reconciled agent even while the first toast is pending', async () => {
    const context = createContext();
    vscodeState.hookInstallerReconcile.mockResolvedValue([
      { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
      { agent: 'codex', configPath: '/home/me/.codex/hooks.json' },
    ]);
    // An ignored toast keeps its promise pending; the codex toast must not wait on it.
    vscodeState.showInformationMessage.mockImplementation(() => new Promise(() => {}));

    await activate(context as never);

    await vi.waitFor(() => {
      expect(vscodeState.showInformationMessage).toHaveBeenCalledWith(
        'Deck updated its Claude Code hooks for this Deck version',
        'Review Changes',
      );
      expect(vscodeState.showInformationMessage).toHaveBeenCalledWith(
        'Deck updated its Codex hooks for this Deck version',
        'Review Changes',
      );
    });
  });

  it('registers deck.removeAgentHooks through the setup prompt uninstall flow', async () => {
    const context = createContext();

    await activate(context as never);
    const registration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.removeAgentHooks',
    );
    if (!registration) throw new Error('missing deck.removeAgentHooks registration');
    await registration[1]();

    expect(vscodeState.agentSetupPromptUninstall).toHaveBeenCalledOnce();
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

  it('opens and reveals a Terminal from an agent status notification action', async () => {
    const context = createContext();
    const terminalNode = {
      terminal: { sessionName: 'wt-_work_alpha-feature__term-1', windowName: 'claude' },
      worktreePath: '/work/alpha-feature',
    };
    vscodeState.showWarningMessage.mockResolvedValue('Open Terminal');

    await activate(context as never);
    vscodeState.repositoryTreeInstances[0].findTerminalBySessionName.mockResolvedValue(terminalNode);
    vscodeState.agentStatusStoreEntries = [
      ['wt-_work_alpha-feature__term-1', {
        status: 'needsInput',
        statusAt: 1710000000,
        message: 'Allow Bash(ls)?',
      }],
    ];
    vscodeState.agentStatusStoreChangeListeners.at(-1)?.();
    await Promise.resolve();

    expect(vscodeState.showWarningMessage).toHaveBeenCalledWith(
      'Allow Bash(ls)?',
      'Open Terminal',
    );
    expect(vscodeState.repositoryTreeInstances[0].findTerminalBySessionName).toHaveBeenCalledWith(
      'wt-_work_alpha-feature__term-1',
    );
    await vi.waitFor(() => {
      expect(vscodeState.openTerminalRun).toHaveBeenCalledWith(terminalNode);
    });
    expect(vscodeState.createTreeView.mock.results[0].value.reveal).toHaveBeenCalledWith(
      terminalNode,
      { select: true, focus: false },
    );
  });

  it('explains instead of silently no-opping when the notified Terminal is not in this window', async () => {
    const context = createContext();
    vscodeState.showWarningMessage.mockResolvedValue('Open Terminal');

    await activate(context as never);
    vscodeState.repositoryTreeInstances[0].findTerminalBySessionName.mockResolvedValue(undefined);
    vscodeState.agentStatusStoreEntries = [
      ['wt-_elsewhere_repo__term-1', { status: 'needsInput', statusAt: 1710000000 }],
    ];
    vscodeState.agentStatusStoreChangeListeners.at(-1)?.();
    await Promise.resolve();

    await vi.waitFor(() => {
      expect(vscodeState.showInformationMessage).toHaveBeenCalledWith(
        "This Terminal's repository isn't registered in this window. Add the repository to Deck to open it.",
      );
    });
    expect(vscodeState.openTerminalRun).not.toHaveBeenCalled();
  });

  it('reveals the active Deck Terminal tab in the tree without taking focus', async () => {
    const context = createContext();
    const terminalNode = {
      terminal: { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      worktreePath: '/work/alpha-main',
    };
    const activeTab = {
      input: {
        viewType: 'deck.terminal',
        uri: {
          scheme: 'deck-terminal',
          path: '/work/alpha-main/term-1',
        },
      },
    };

    await activate(context as never);
    vscodeState.repositoryTreeInstances[0].findTerminal.mockResolvedValue(terminalNode);
    vscodeState.activeTab = activeTab;
    const tabChangeHandler = vscodeState.onDidChangeTabs.mock.calls[0]?.[0];
    if (!tabChangeHandler) throw new Error('missing tab change listener');
    await tabChangeHandler({ opened: [], closed: [], changed: [activeTab] });

    expect(vscodeState.repositoryTreeInstances[0].findTerminal).toHaveBeenCalledWith(
      'wt-_work_alpha-main__term-1',
      '/work/alpha-main',
    );
    expect(vscodeState.createTreeView.mock.results[0].value.reveal).toHaveBeenCalledWith(
      terminalNode,
      { select: true, focus: false },
    );
  });

  it('marks the active Deck Terminal read when its tab is focused or status changes', async () => {
    const context = createContext();
    const activeTab = {
      input: {
        viewType: 'deck.terminal',
        uri: {
          scheme: 'deck-terminal',
          path: '/work/alpha-main/term-1',
        },
      },
    };

    await activate(context as never);
    vscodeState.activeTab = activeTab;
    const tabChangeHandler = vscodeState.onDidChangeTabs.mock.calls[0]?.[0];
    if (!tabChangeHandler) throw new Error('missing tab change listener');
    await tabChangeHandler({ opened: [], closed: [], changed: [activeTab] });

    expect(vscodeState.agentStatusStoreMarkRead).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');

    vscodeState.agentStatusStoreMarkRead.mockClear();
    vscodeState.agentStatusStoreChangeListener?.();
    await Promise.resolve();

    expect(vscodeState.agentStatusStoreMarkRead).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');
  });

  it('does not reveal a tree row when a non-Terminal tab becomes active', async () => {
    const context = createContext();
    vscodeState.activeTab = {
      input: {
        viewType: 'default',
        uri: {
          scheme: 'file',
          path: '/work/alpha-main/src/index.ts',
        },
      },
    };

    await activate(context as never);
    const tabChangeHandler = vscodeState.onDidChangeTabs.mock.calls[0]?.[0];
    if (!tabChangeHandler) throw new Error('missing tab change listener');
    await tabChangeHandler({ opened: [], closed: [], changed: [vscodeState.activeTab] });

    expect(vscodeState.repositoryTreeInstances[0].findTerminal).not.toHaveBeenCalled();
    expect(vscodeState.createTreeView.mock.results[0].value.reveal).not.toHaveBeenCalled();
  });

  it('registers deck.killTerminal through TerminalRemovalCommand', async () => {
    const context = createContext();

    await activate(context as never);
    const terminalRemovalRegistration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.killTerminal',
    );
    if (!terminalRemovalRegistration) throw new Error('missing deck.killTerminal registration');
    await terminalRemovalRegistration[1]({ terminal: { sessionName: 's', windowName: 'zsh' } });

    expect(vscodeState.terminalRemovalRun).toHaveBeenCalledWith({
      terminal: { sessionName: 's', windowName: 'zsh' },
    });
  });

  it('deletes the selected Terminal when deck.killTerminal is invoked from a keybinding', async () => {
    const context = createContext();
    const selectedTerminal = { terminal: { sessionName: 's', windowName: 'zsh' } };

    await activate(context as never);
    vscodeState.treeViewSelection = [selectedTerminal];
    const registration = vscodeState.registerCommand.mock.calls.find(
      ([command]) => command === 'deck.killTerminal',
    );
    if (!registration) throw new Error('missing deck.killTerminal registration');
    await registration[1]();

    expect(vscodeState.terminalRemovalRun).toHaveBeenCalledWith(selectedTerminal);
  });

  it('registers deck.terminal.find', async () => {
    const context = createContext();

    await activate(context as never);

    expect(vscodeState.registerCommand).toHaveBeenCalledWith(
      'deck.terminal.find',
      expect.any(Function),
    );
  });

  it('refreshes without killing tmux when a Deck custom-editor tab is disposed', async () => {
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
      path: '/work/repo/term-1',
    });
    provider.resolveCustomEditor(document, panel);
    disposePanel?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(vscodeState.tmuxInstances[0].killSession).not.toHaveBeenCalled();
    expect(vscodeState.repositoryTreeInstances[0].refresh).toHaveBeenCalledOnce();
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
        path: '/work/alpha-main/term-1',
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
                path: '/work/alpha-main/term-1',
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
