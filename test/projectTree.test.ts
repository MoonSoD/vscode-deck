import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vi.fn(),
  },
  EventEmitter: class {
    readonly event = vi.fn();
    fire = vi.fn();
  },
  ThemeIcon: class {
    constructor(readonly id: string) {}
  },
  TreeItem: class {
    contextValue?: string;
    description?: string;
    iconPath?: unknown;
    command?: unknown;

    constructor(
      readonly label: string,
      readonly collapsibleState?: number,
    ) {}
  },
  TreeItemCollapsibleState: {
    None: 0,
    Collapsed: 1,
    Expanded: 2,
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
  window: {
    showErrorMessage: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: <T>(_key: string, defaultValue: T) =>
        ['/work/alpha-main', '/work/beta-main'] as T,
      update: vi.fn(),
    })),
    workspaceFolders: [{ uri: { fsPath: '/work/beta-main' } }],
  },
}));

vi.mock('../src/git/worktrees', () => ({
  getCommonDir: vi.fn(async (worktreePath: string) =>
    worktreePath.startsWith('/work/alpha') ? '/git/alpha' : '/git/beta',
  ),
  getCommonDirSafe: vi.fn(async (worktreePath: string) =>
    worktreePath.startsWith('/work/alpha') ? '/git/alpha' : '/git/beta',
  ),
  listWorktrees: vi.fn(async (projectPath: string) => {
    if (projectPath === '/work/alpha-main') {
      return [
        {
          path: '/work/alpha-main',
          head: 'a',
          bare: false,
          detached: false,
          branch: 'main',
        },
        {
          path: '/work/alpha-feature',
          head: 'aa',
          bare: false,
          detached: false,
          branch: 'feature',
        },
      ];
    }

    return [
      {
        path: '/work/beta-main',
        head: 'b',
        bare: false,
        detached: false,
        branch: 'main',
      },
    ];
  }),
}));

import * as vscode from 'vscode';
import { ActiveWorktreeStore } from '../src/switch/activeWorktreeStore';
import { ProjectTreeProvider } from '../src/tree/projectTree';
import { WorktreeListCacheStore } from '../src/worktree/worktreeListCacheStore';
import { WorktreeOrderStore } from '../src/worktree/worktreeOrderStore';
import { ProjectCommonDirCache } from '../src/project/projectCommonDirCache';
import { ProjectRegistryStore } from '../src/project/projectRegistryStore';
import { TerminalSessionListCacheStore } from '../src/terminal/terminalSessionListCacheStore';

function registry(projects = ['/work/alpha-main', '/work/beta-main']) {
  return {
    list: vi.fn(() => projects),
  } as unknown as ProjectRegistryStore;
}

describe('ProjectTreeProvider', () => {
  it('marks only the currently mounted worktree as active', async () => {
    const get = vi.fn((commonDir: string) =>
      commonDir === '/git/alpha' ? '/work/alpha-main' : '/work/beta-main',
    );
    const activeWorktrees = {
      get,
    } as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(),
    } as unknown as WorktreeOrderStore;
    const provider = new ProjectTreeProvider(registry(), activeWorktrees, worktreeOrders);

    const projects = provider.getChildren();
    if (!Array.isArray(projects)) throw new Error('expected sync project roots');

    const worktreeNodes = (
      await Promise.all(projects.map((project) => provider.getChildren(project)))
    ).flat();

    expect(worktreeNodes.map((node) => node.contextValue)).toEqual([
      'deck.worktree.main',
      'deck.worktree',
      'deck.worktree.active',
    ]);
    expect(worktreeNodes.map((node) => (node.iconPath as { id: string }).id)).toEqual([
      'git-branch',
      'git-branch',
      'check',
    ]);
    expect(get).not.toHaveBeenCalled();
  });

  it('renders worktrees in stored order with unknown worktrees appended', async () => {
    const activeWorktrees = {
      get: vi.fn(),
    } as unknown as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(() => ['/work/alpha-feature']),
    } as unknown as WorktreeOrderStore;
    const provider = new ProjectTreeProvider(registry(), activeWorktrees, worktreeOrders);

    const projectNode = provider.getChildren();
    if (!Array.isArray(projectNode)) throw new Error('expected sync project roots');

    const worktreeNodes = await provider.getChildren(projectNode[0]);
    if (!Array.isArray(worktreeNodes)) throw new Error('expected worktree children');

    expect(worktreeOrders.get).toHaveBeenCalledWith('/git/alpha');
    expect(worktreeNodes.map((node) => ('worktree' in node ? node.worktree.path : ''))).toEqual([
      '/work/alpha-feature',
      '/work/alpha-main',
    ]);
    expect(worktreeNodes.map((node) => node.contextValue)).toEqual([
      'deck.worktree',
      'deck.worktree.main',
    ]);
  });

  it('renders warm cached worktrees synchronously and refreshes in the background only on diff', async () => {
    const activeWorktrees = {
      get: vi.fn(),
    } as unknown as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(),
    } as unknown as WorktreeOrderStore;
    const worktreeListCache = {
      get: vi.fn(() => [
        {
          path: '/work/alpha-main',
          head: 'a',
          bare: false,
          detached: false,
          branch: 'main',
        },
      ]),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeListCacheStore;
    const projectCommonDirCache = {
      get: vi.fn(() => '/git/alpha'),
      set: vi.fn(async () => undefined),
    } as unknown as ProjectCommonDirCache;
    const provider = new ProjectTreeProvider(
      registry(),
      activeWorktrees,
      worktreeOrders,
      worktreeListCache,
      projectCommonDirCache,
    );

    const projectNode = provider.getChildren();
    if (!Array.isArray(projectNode)) throw new Error('expected sync project roots');

    const worktreeNodes = provider.getChildren(projectNode[0]);

    expect(Array.isArray(worktreeNodes)).toBe(true);
    expect((worktreeNodes as Array<{ worktree: { path: string } }>).map((node) => node.worktree.path)).toEqual([
      '/work/alpha-main',
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worktreeListCache.set).toHaveBeenCalledWith('/git/alpha', [
      {
        path: '/work/alpha-main',
        head: 'a',
        bare: false,
        detached: false,
        branch: 'main',
      },
      {
        path: '/work/alpha-feature',
        head: 'aa',
        bare: false,
        detached: false,
        branch: 'feature',
      },
    ]);
  });

  it('keeps warm cached worktrees when the background refresh has no logical diff', async () => {
    const activeWorktrees = {
      get: vi.fn(),
    } as unknown as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(),
    } as unknown as WorktreeOrderStore;
    const worktreeListCache = {
      get: vi.fn(() => [
        {
          path: '/work/alpha-main',
          head: 'a',
          branch: 'main',
          bare: false,
          detached: false,
        },
        {
          path: '/work/alpha-feature',
          head: 'aa',
          branch: 'feature',
          bare: false,
          detached: false,
        },
      ]),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeListCacheStore;
    const projectCommonDirCache = {
      get: vi.fn(() => '/git/alpha'),
      set: vi.fn(async () => undefined),
    } as unknown as ProjectCommonDirCache;
    const provider = new ProjectTreeProvider(
      registry(),
      activeWorktrees,
      worktreeOrders,
      worktreeListCache,
      projectCommonDirCache,
    );

    const projectNode = provider.getChildren();
    if (!Array.isArray(projectNode)) throw new Error('expected sync project roots');

    provider.getChildren(projectNode[0]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worktreeListCache.set).not.toHaveBeenCalled();
  });

  it('reads root Projects from ProjectRegistryStore without reading deck.projects settings', () => {
    const activeWorktrees = {
      get: vi.fn(),
    } as unknown as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(),
    } as unknown as WorktreeOrderStore;
    const projectRegistry = registry(['/work/beta-main']);
    const provider = new ProjectTreeProvider(projectRegistry, activeWorktrees, worktreeOrders);

    const projects = provider.getChildren();

    expect(Array.isArray(projects)).toBe(true);
    expect((projects as Array<{ projectPath: string }>).map((node) => node.projectPath)).toEqual([
      '/work/beta-main',
    ]);
    expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
  });

  it('renders existing Worktree terminals above the add row when tmux is available', async () => {
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_alpha-main__term-2', windowName: 'claude' },
        { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      ]),
    };
    const provider = new ProjectTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as ProjectCommonDirCache,
      tmux,
      true,
    );
    const projects = provider.getChildren();
    if (!Array.isArray(projects)) throw new Error('expected sync project roots');

    const worktrees = await provider.getChildren(projects[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');

    expect(worktrees[0].collapsibleState).toBe(1);
    expect(worktrees[0].command).toMatchObject({ command: 'deck.switchWorktree' });
    const terminalRows = await provider.getChildren(worktrees[0]);

    expect(Array.isArray(terminalRows)).toBe(true);
    expect((terminalRows as Array<{ label: string; command?: { command: string } }>)).toEqual([
      expect.objectContaining({
        label: '1 zsh',
        command: expect.objectContaining({ command: 'deck.openTerminal' }),
      }),
      expect.objectContaining({
        label: '2 claude',
        command: expect.objectContaining({ command: 'deck.openTerminal' }),
      }),
      expect.objectContaining({
        label: 'Add Terminal',
        command: expect.objectContaining({ command: 'deck.addTerminal' }),
      }),
    ]);
    expect(tmux.listSessions).toHaveBeenCalledWith('wt-_work_alpha-main__term-');
  });

  it('renders warm cached terminals synchronously and refreshes in the background only on diff', async () => {
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
        { sessionName: 'wt-_work_alpha-main__term-2', windowName: 'claude' },
      ]),
    };
    const terminalSessionListCache = {
      get: vi.fn(() => [
        { sessionName: 'wt-_work_alpha-main__term-1', n: 1, windowName: 'zsh' },
      ]),
      set: vi.fn(async () => undefined),
    } as unknown as TerminalSessionListCacheStore;
    const provider = new ProjectTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as ProjectCommonDirCache,
      tmux,
      true,
      terminalSessionListCache,
    );
    const projects = provider.getChildren();
    if (!Array.isArray(projects)) throw new Error('expected sync project roots');
    const worktrees = await provider.getChildren(projects[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');
    const fire = (provider as unknown as { _onDidChangeTreeData: { fire: { mockClear(): void } } })._onDidChangeTreeData.fire;
    fire.mockClear();

    const terminalRows = provider.getChildren(worktrees[0]);

    expect(Array.isArray(terminalRows)).toBe(true);
    expect((terminalRows as Array<{ label: string }>).map((row) => row.label)).toEqual([
      '1 zsh',
      'Add Terminal',
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(tmux.listSessions).toHaveBeenCalledWith('wt-_work_alpha-main__term-');
    expect(terminalSessionListCache.set).toHaveBeenCalledWith('wt-_work_alpha-main__', [
      { sessionName: 'wt-_work_alpha-main__term-1', n: 1, windowName: 'zsh' },
      { sessionName: 'wt-_work_alpha-main__term-2', n: 2, windowName: 'claude' },
    ]);
    expect(fire).toHaveBeenCalledWith(undefined);
  });

  it('detects a window-name change with no list-shape change as a diff', async () => {
    // Locks the windowName-sensitivity invariant: if a row's underlying
    // tmux window auto-renames (zsh → claude) but the session set is
    // otherwise identical, the cache MUST update and the tree MUST fire.
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'claude' },
      ]),
    };
    const terminalSessionListCache = {
      get: vi.fn(() => [
        { sessionName: 'wt-_work_alpha-main__term-1', n: 1, windowName: 'zsh' },
      ]),
      set: vi.fn(async () => undefined),
    } as unknown as TerminalSessionListCacheStore;
    const provider = new ProjectTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as ProjectCommonDirCache,
      tmux,
      true,
      terminalSessionListCache,
    );
    const projects = provider.getChildren();
    if (!Array.isArray(projects)) throw new Error('expected sync project roots');
    const worktrees = await provider.getChildren(projects[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');
    const fire = (provider as unknown as { _onDidChangeTreeData: { fire: { mockClear(): void } } })._onDidChangeTreeData.fire;
    fire.mockClear();

    provider.getChildren(worktrees[0]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(terminalSessionListCache.set).toHaveBeenCalledWith('wt-_work_alpha-main__', [
      { sessionName: 'wt-_work_alpha-main__term-1', n: 1, windowName: 'claude' },
    ]);
    expect(fire).toHaveBeenCalledWith(undefined);
  });

  it('keeps warm cached terminals when the background refresh has no logical diff', async () => {
    const terminals = [
      { sessionName: 'wt-_work_alpha-main__term-1', n: 1, windowName: 'zsh' },
      { sessionName: 'wt-_work_alpha-main__term-2', n: 2, windowName: 'claude' },
    ];
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
        { sessionName: 'wt-_work_alpha-main__term-2', windowName: 'claude' },
      ]),
    };
    const terminalSessionListCache = {
      get: vi.fn(() => terminals),
      set: vi.fn(async () => undefined),
    } as unknown as TerminalSessionListCacheStore;
    const provider = new ProjectTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as ProjectCommonDirCache,
      tmux,
      true,
      terminalSessionListCache,
    );
    const projects = provider.getChildren();
    if (!Array.isArray(projects)) throw new Error('expected sync project roots');
    const worktrees = await provider.getChildren(projects[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');
    const fire = (provider as unknown as { _onDidChangeTreeData: { fire: { mockClear(): void } } })._onDidChangeTreeData.fire;
    fire.mockClear();

    provider.getChildren(worktrees[0]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(terminalSessionListCache.set).not.toHaveBeenCalled();
    expect(fire).not.toHaveBeenCalled();
  });

  it('renders tmux install placeholder when tmux is unavailable', async () => {
    const provider = new ProjectTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as ProjectCommonDirCache,
      false,
    );
    const projects = provider.getChildren();
    if (!Array.isArray(projects)) throw new Error('expected sync project roots');

    const worktrees = await provider.getChildren(projects[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');
    const terminalRows = provider.getChildren(worktrees[0]);

    expect(Array.isArray(terminalRows)).toBe(true);
    expect((terminalRows as Array<{ label: string; command?: unknown }>)).toEqual([
      expect.objectContaining({
        label: 'tmux ≥3.1 not found · install ↗',
        command: undefined,
      }),
    ]);
  });
});
