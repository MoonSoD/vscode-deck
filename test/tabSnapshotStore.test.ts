import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  tabGroups: [] as unknown[],
  workspaceFolders: [{ uri: { fsPath: '/work/alpha-main' } }],
}));

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vscodeState.executeCommand,
  },
  Uri: {
    from(value: { scheme: string; authority: string; path: string; query: string }) {
      return value;
    },
  },
  ViewColumn: {
    One: 1,
    Two: 2,
  },
  window: {
    tabGroups: {
      get all() {
        return vscodeState.tabGroups;
      },
    },
  },
  workspace: {
    get workspaceFolders() {
      return vscodeState.workspaceFolders;
    },
  },
}));

import { TabSnapshotStore, TERMINAL_SNAPSHOT_KEY } from '../src/terminal/tabSnapshotStore';

function createStore() {
  const values: Record<string, unknown> = {};
  const update = vi.fn(async (key: string, value: unknown) => {
    values[key] = value;
  });
  const store = new TabSnapshotStore({
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update,
  });

  return { store, values, update };
}

function terminalTab(
  sessionName: string,
  options: { active?: boolean; pinned?: boolean } = {},
) {
  return {
    input: {
      viewType: 'deck.terminal',
      uri: {
        scheme: 'deck-terminal',
        path: `/${sessionName}`,
        query: 'cwd=%2Fwork%2Falpha-main',
      },
    },
    isActive: options.active ?? false,
    isPinned: options.pinned ?? false,
  };
}

describe('TabSnapshotStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.executeCommand.mockResolvedValue({ groups: [{ size: 1 }, { size: 1 }] });
    vscodeState.tabGroups = [];
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main' } }];
  });

  it('captures Deck terminal placement for the current worktree only', async () => {
    const { store, values } = createStore();
    vscodeState.tabGroups = [
      {
        viewColumn: 1,
        tabs: [
          terminalTab('wt-_work_alpha-main__term-1', { pinned: true }),
          { input: { viewType: 'not.deck' }, isActive: false, isPinned: false },
          terminalTab('wt-_work_beta-main__term-1'),
        ],
      },
      {
        viewColumn: 2,
        tabs: [terminalTab('wt-_work_alpha-main__term-2', { active: true })],
      },
    ];

    await store.capture();

    expect(vscodeState.executeCommand).toHaveBeenCalledWith('vscode.getEditorLayout');
    expect(values[TERMINAL_SNAPSHOT_KEY]).toEqual({
      schemaVersion: 1,
      layout: { groups: [{ size: 1 }, { size: 1 }] },
      tabs: [
        {
          sessionName: 'wt-_work_alpha-main__term-1',
          viewColumn: 1,
          index: 0,
          pinned: true,
          active: false,
        },
        {
          sessionName: 'wt-_work_alpha-main__term-2',
          viewColumn: 2,
          index: 0,
          pinned: false,
          active: true,
        },
      ],
    });
  });

  it('restores layout, tab placement, pinned tabs, and active tabs', async () => {
    const { store, values } = createStore();
    values[TERMINAL_SNAPSHOT_KEY] = {
      schemaVersion: 1,
      layout: { groups: [{ size: 1 }, { size: 1 }] },
      tabs: [
        {
          sessionName: 'wt-_work_alpha-main__term-2',
          viewColumn: 2,
          index: 1,
          pinned: true,
          active: true,
        },
        {
          sessionName: 'wt-_work_alpha-main__term-1',
          viewColumn: 2,
          index: 0,
          pinned: false,
          active: false,
        },
      ],
    };

    await store.restore();

    expect(vscodeState.executeCommand.mock.calls).toEqual([
      ['vscode.setEditorLayout', { groups: [{ size: 1 }, { size: 1 }] }],
      [
        'vscode.openWith',
        {
          scheme: 'deck-terminal',
          authority: 'session',
          path: '/wt-_work_alpha-main__term-1',
          query: 'cwd=%2Fwork%2Falpha-main',
        },
        'deck.terminal',
        { viewColumn: 2, preserveFocus: true },
      ],
      [
        'vscode.openWith',
        {
          scheme: 'deck-terminal',
          authority: 'session',
          path: '/wt-_work_alpha-main__term-2',
          query: 'cwd=%2Fwork%2Falpha-main',
        },
        'deck.terminal',
        { viewColumn: 2, preserveFocus: false },
      ],
      [
        'vscode.openWith',
        {
          scheme: 'deck-terminal',
          authority: 'session',
          path: '/wt-_work_alpha-main__term-2',
          query: 'cwd=%2Fwork%2Falpha-main',
        },
        'deck.terminal',
        { viewColumn: 2, preserveFocus: false },
      ],
      ['workbench.action.pinEditor'],
      [
        'vscode.openWith',
        {
          scheme: 'deck-terminal',
          authority: 'session',
          path: '/wt-_work_alpha-main__term-2',
          query: 'cwd=%2Fwork%2Falpha-main',
        },
        'deck.terminal',
        { viewColumn: 2, preserveFocus: false },
      ],
    ]);
  });

  it('resets mismatched schema snapshots and restores nothing', async () => {
    const { store, values } = createStore();
    values[TERMINAL_SNAPSHOT_KEY] = {
      schemaVersion: 0,
      layout: { stale: true },
      tabs: [
        {
          sessionName: 'wt-_work_alpha-main__term-1',
          viewColumn: 1,
          index: 0,
          pinned: false,
          active: true,
        },
      ],
    };

    await store.restore();

    expect(vscodeState.executeCommand).not.toHaveBeenCalled();
    expect(values[TERMINAL_SNAPSHOT_KEY]).toEqual({
      schemaVersion: 1,
      layout: undefined,
      tabs: [],
    });
  });
});
