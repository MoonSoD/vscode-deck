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

describe('ProjectTreeProvider', () => {
  it('marks only the currently mounted worktree as active', async () => {
    const get = vi.fn((commonDir: string) =>
      commonDir === '/git/alpha' ? '/work/alpha-main' : '/work/beta-main',
    );
    const activeWorktrees = {
      get,
    } as ActiveWorktreeStore;
    const provider = new ProjectTreeProvider(activeWorktrees);

    const projects = provider.getChildren();
    if (!Array.isArray(projects)) throw new Error('expected sync project roots');

    const worktreeNodes = (
      await Promise.all(projects.map((project) => provider.getChildren(project)))
    ).flat();

    expect(worktreeNodes.map((node) => node.contextValue)).toEqual([
      'deck.worktree',
      'deck.worktree.active',
    ]);
    expect(worktreeNodes.map((node) => (node.iconPath as { id: string }).id)).toEqual([
      'git-branch',
      'check',
    ]);
    expect(get).not.toHaveBeenCalled();
  });
});
