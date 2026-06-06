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
    getConfiguration: () => ({
      get: <T>(_key: string, defaultValue: T) =>
        ['/work/alpha-main', '/work/beta-main'] as T,
      update: vi.fn(),
    }),
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

import { ActiveWorktreeStore } from '../src/switch/activeWorktreeStore';
import { ProjectTreeProvider } from '../src/tree/projectTree';
import { WorktreeListCacheStore } from '../src/worktree/worktreeListCacheStore';
import { WorktreeOrderStore } from '../src/worktree/worktreeOrderStore';
import { ProjectCommonDirCache } from '../src/project/projectCommonDirCache';

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
    const provider = new ProjectTreeProvider(activeWorktrees, worktreeOrders);

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
    const provider = new ProjectTreeProvider(activeWorktrees, worktreeOrders);

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
});
