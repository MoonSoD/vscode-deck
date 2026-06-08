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
  listWorktrees: vi.fn(async (repositoryPath: string) => {
    if (repositoryPath === '/work/alpha-main') {
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
import { RepositoryTreeProvider } from '../src/tree/repositoryTree';
import { WorktreeListCacheStore } from '../src/worktree/worktreeListCacheStore';
import { WorktreeOrderStore } from '../src/worktree/worktreeOrderStore';
import { RepositoryCommonDirCache } from '../src/repository/repositoryCommonDirCache';
import { RepositoryRegistryStore } from '../src/repository/repositoryRegistryStore';
import { listWorktrees, type Worktree } from '../src/git/worktrees';

function registry(repositories = ['/work/alpha-main', '/work/beta-main']) {
  return {
    list: vi.fn(() => repositories),
  } as unknown as RepositoryRegistryStore;
}

const alphaMainWorktree: Worktree = {
  path: '/work/alpha-main',
  head: 'a',
  bare: false,
  detached: false,
  branch: 'main',
};

const alphaFeatureWorktree: Worktree = {
  path: '/work/alpha-feature',
  head: 'aa',
  bare: false,
  detached: false,
  branch: 'feature',
};

describe('RepositoryTreeProvider', () => {
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
    const provider = new RepositoryTreeProvider(registry(), activeWorktrees, worktreeOrders);

    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');

    const worktreeNodes = (
      await Promise.all(repositories.map((repository) => provider.getChildren(repository)))
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
    const provider = new RepositoryTreeProvider(registry(), activeWorktrees, worktreeOrders);

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    const worktreeNodes = await provider.getChildren(repositoryNode[0]);
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
    const repositoryCommonDirCache = {
      get: vi.fn(() => '/git/alpha'),
      set: vi.fn(async () => undefined),
    } as unknown as RepositoryCommonDirCache;
    const provider = new RepositoryTreeProvider(
      registry(),
      activeWorktrees,
      worktreeOrders,
      worktreeListCache,
      repositoryCommonDirCache,
    );

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    const worktreeNodes = provider.getChildren(repositoryNode[0]);

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
    const repositoryCommonDirCache = {
      get: vi.fn(() => '/git/alpha'),
      set: vi.fn(async () => undefined),
    } as unknown as RepositoryCommonDirCache;
    const provider = new RepositoryTreeProvider(
      registry(),
      activeWorktrees,
      worktreeOrders,
      worktreeListCache,
      repositoryCommonDirCache,
    );

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    provider.getChildren(repositoryNode[0]);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(worktreeListCache.set).not.toHaveBeenCalled();
  });

  it('hides pending worktree removals from warm cached rows', () => {
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
        {
          path: '/work/alpha-feature',
          head: 'aa',
          bare: false,
          detached: false,
          branch: 'feature',
        },
      ]),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeListCacheStore;
    const repositoryCommonDirCache = {
      get: vi.fn(() => '/git/alpha'),
      set: vi.fn(async () => undefined),
    } as unknown as RepositoryCommonDirCache;
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      activeWorktrees,
      worktreeOrders,
      worktreeListCache,
      repositoryCommonDirCache,
      true,
      undefined,
      new Set(['/work/alpha-feature']),
    );

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    const worktreeNodes = provider.getChildren(repositoryNode[0]);

    expect(Array.isArray(worktreeNodes)).toBe(true);
    expect((worktreeNodes as Array<{ worktree: { path: string } }>).map((node) => node.worktree.path)).toEqual([
      '/work/alpha-main',
    ]);
  });

  it('does not re-add pending worktree removals during background refresh', async () => {
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
    const repositoryCommonDirCache = {
      get: vi.fn(() => '/git/alpha'),
      set: vi.fn(async () => undefined),
    } as unknown as RepositoryCommonDirCache;
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      activeWorktrees,
      worktreeOrders,
      worktreeListCache,
      repositoryCommonDirCache,
      true,
      undefined,
      new Set(['/work/alpha-feature']),
    );

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');

    provider.getChildren(repositoryNode[0]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(worktreeListCache.set).not.toHaveBeenCalled();
  });

  it('keeps a stale refresh from re-adding a removal that settled while it was in flight', async () => {
    const pendingRemovals = new Set(['/work/alpha-feature']);
    const worktreeListCache = {
      get: vi.fn(() => [alphaMainWorktree]),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeListCacheStore;
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      worktreeListCache,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      true,
      undefined,
      pendingRemovals,
    );
    vi.mocked(listWorktrees).mockResolvedValueOnce([
      alphaMainWorktree,
      alphaFeatureWorktree,
    ]);

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');
    provider.getChildren(repositoryNode[0]);
    pendingRemovals.delete('/work/alpha-feature');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(worktreeListCache.set).not.toHaveBeenCalled();
  });

  it('filters a removal that becomes pending while background refresh is in flight', async () => {
    const pendingRemovals = new Set<string>();
    const worktreeListCache = {
      get: vi.fn(() => [alphaMainWorktree, alphaFeatureWorktree]),
      set: vi.fn(async () => undefined),
    } as unknown as WorktreeListCacheStore;
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      worktreeListCache,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      true,
      undefined,
      pendingRemovals,
    );
    vi.mocked(listWorktrees).mockResolvedValueOnce([
      alphaMainWorktree,
      alphaFeatureWorktree,
    ]);

    const repositoryNode = provider.getChildren();
    if (!Array.isArray(repositoryNode)) throw new Error('expected sync repository roots');
    provider.getChildren(repositoryNode[0]);
    pendingRemovals.add('/work/alpha-feature');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(worktreeListCache.set).toHaveBeenCalledWith('/git/alpha', [
      alphaMainWorktree,
    ]);
  });

  it('reads root Repositories from RepositoryRegistryStore without reading deck.repositories settings', () => {
    const activeWorktrees = {
      get: vi.fn(),
    } as unknown as ActiveWorktreeStore;
    const worktreeOrders = {
      get: vi.fn(),
    } as unknown as WorktreeOrderStore;
    const repositoryRegistry = registry(['/work/beta-main']);
    const provider = new RepositoryTreeProvider(repositoryRegistry, activeWorktrees, worktreeOrders);

    const repositories = provider.getChildren();

    expect(Array.isArray(repositories)).toBe(true);
    expect((repositories as Array<{ repositoryPath: string }>).map((node) => node.repositoryPath)).toEqual([
      '/work/beta-main',
    ]);
    expect(vscode.workspace.getConfiguration).not.toHaveBeenCalled();
  });

  it('renders existing Worktree terminals expanded without the add row when tmux is available', async () => {
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_alpha-main__term-2', windowName: 'claude' },
        { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      ]),
    };
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      tmux,
      true,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');

    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');

    expect(worktrees.map((worktree) => worktree.collapsibleState)).toEqual([2, 2]);
    expect(worktrees[0].command).toBeUndefined();
    const terminalRows = await provider.getChildren(worktrees[0]);
    const emptyRows = await provider.getChildren(worktrees[1]);

    expect(Array.isArray(terminalRows)).toBe(true);
    expect(emptyRows).toEqual([]);
    expect((terminalRows as Array<{ label: string; command?: { command: string } }>)).toEqual([
      expect.objectContaining({
        label: 'zsh',
        command: expect.objectContaining({ command: 'deck.openTerminal' }),
        worktreePath: '/work/alpha-main',
        contextValue: 'deck.terminal.foreign',
      }),
      expect.objectContaining({
        label: 'claude',
        command: expect.objectContaining({ command: 'deck.openTerminal' }),
        worktreePath: '/work/alpha-main',
        contextValue: 'deck.terminal.foreign',
      }),
    ]);
    expect(tmux.listSessions).toHaveBeenCalledWith('wt-_work_alpha-main__term-');
  });

  it('returns parent rows for Worktree and Terminal rows', async () => {
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      ]),
    };
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      tmux,
      true,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');
    const terminals = await provider.getChildren(worktrees[0]);
    if (!Array.isArray(terminals)) throw new Error('expected terminal children');

    expect(provider.getParent(worktrees[0])).toMatchObject({
      id: 'repository::/work/alpha-main',
      repositoryPath: '/work/alpha-main',
    });
    expect(provider.getParent(terminals[0])).toMatchObject({
      id: 'worktree::/work/alpha-main',
      repositoryPath: '/work/alpha-main',
      worktree: { path: '/work/alpha-main' },
    });
  });

  it('finds a Terminal row outside the mounted Worktree', async () => {
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_alpha-feature__term-1', windowName: 'claude' },
      ]),
    };
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      tmux,
      true,
    );

    const terminal = await provider.findTerminal(
      'wt-_work_alpha-feature__term-1',
      '/work/alpha-feature',
    );

    expect(terminal).toMatchObject({
      id: 'terminal::wt-_work_alpha-feature__term-1',
      worktreePath: '/work/alpha-feature',
      terminal: { windowName: 'claude' },
    });
    expect(provider.getParent(terminal!)).toMatchObject({
      id: 'worktree::/work/alpha-feature',
    });
  });

  it('marks terminals in the current workspace folder as active', async () => {
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_beta-main__term-1', windowName: 'zsh' },
      ]),
    };
    const provider = new RepositoryTreeProvider(
      registry(['/work/beta-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/beta'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      tmux,
      true,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');
    const terminalRows = await provider.getChildren(worktrees[0]);

    expect((terminalRows as Array<{ contextValue: string }>).map((r) => r.contextValue)).toEqual([
      'deck.terminal.active',
    ]);
  });

  it('renders an empty Worktree as an expanded empty folder with no rows when no terminals exist', async () => {
    const tmux = { listSessions: vi.fn(async () => []) };
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      tmux,
      true,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');

    expect(worktrees[0].collapsibleState).toBe(2);
    const terminalRows = await provider.getChildren(worktrees[0]);
    expect(terminalRows).toEqual([]);
  });

  it('resolves terminal rows from live tmux and re-lists after refresh', async () => {
    const tmux = {
      listSessions: vi
        .fn()
        .mockResolvedValueOnce([
          { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
        ])
        .mockResolvedValueOnce([
          { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'claude' },
        ]),
    };
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      tmux,
      true,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');
    const worktrees = await provider.getChildren(repositories[0]);
    if (!Array.isArray(worktrees)) throw new Error('expected worktree children');

    const firstRows = await provider.getChildren(worktrees[0]);
    provider.refresh();
    const secondRows = await provider.getChildren(worktrees[0]);

    expect(tmux.listSessions).toHaveBeenCalledTimes(2);
    expect((firstRows as Array<{ label: string }>).map((row) => row.label)).toEqual(['zsh']);
    expect((secondRows as Array<{ label: string }>).map((row) => row.label)).toEqual(['claude']);
  });

  it('renders tmux install placeholder when tmux is unavailable', async () => {
    const provider = new RepositoryTreeProvider(
      registry(['/work/alpha-main']),
      { get: vi.fn() } as unknown as ActiveWorktreeStore,
      { get: vi.fn() } as unknown as WorktreeOrderStore,
      { get: vi.fn(), set: vi.fn(async () => undefined) } as unknown as WorktreeListCacheStore,
      { get: vi.fn(() => '/git/alpha'), set: vi.fn(async () => undefined) } as unknown as RepositoryCommonDirCache,
      false,
    );
    const repositories = provider.getChildren();
    if (!Array.isArray(repositories)) throw new Error('expected sync repository roots');

    const worktrees = await provider.getChildren(repositories[0]);
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
