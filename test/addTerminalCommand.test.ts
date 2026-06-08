import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  createTerminal: vi.fn(() => ({ show: vi.fn() })),
  executeCommand: vi.fn(async () => undefined),
  workspaceFolders: [{ uri: { fsPath: '/work/repo' } }],
}));

vi.mock('vscode', () => ({
  ViewColumn: { Active: -1 },
  Uri: {
    from(value: { scheme: string; authority: string; path: string; query: string }) {
      return value;
    },
  },
  commands: {
    executeCommand: vscodeState.executeCommand,
  },
  window: {
    createTerminal: vscodeState.createTerminal,
  },
  workspace: {
    get workspaceFolders() {
      return vscodeState.workspaceFolders;
    },
  },
}));

import { AddTerminalCommand } from '../src/terminal/addTerminalCommand';

describe('AddTerminalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/repo' } }];
  });

  it('allocates the next terminal in tmux and opens it as a Deck custom editor', async () => {
    const existing = [
      { sessionName: 'wt-_work_repo__term-1', windowName: 'zsh' },
      { sessionName: 'wt-_work_repo__term-3', windowName: 'claude' },
    ];
    const tmux = {
      listSessions: vi.fn().mockResolvedValueOnce(existing),
      ensureSession: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();

    await new AddTerminalCommand(
      tmux,
      refresh,
    ).run({ worktree: { path: '/work/repo' } });

    expect(tmux.ensureSession).toHaveBeenCalledWith(
      'wt-_work_repo__term-4',
      '/work/repo',
    );
    expect(vscodeState.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      {
        scheme: 'deck-terminal',
        path: '/work/repo/term-4',
      },
      'deck.terminal',
      { viewColumn: -1 },
    );
    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('creates and opens cross-worktree terminals in place with the worktree cwd', async () => {
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main' } }];
    const tmux = {
      listSessions: vi.fn().mockResolvedValueOnce([]),
      ensureSession: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    await new AddTerminalCommand(
      tmux,
      refresh,
    ).run({ worktree: { path: '/work/beta-main' } });

    expect(tmux.ensureSession).toHaveBeenCalledWith(
      'wt-_work_beta-main__term-1',
      '/work/beta-main',
    );
    expect(vscodeState.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      {
        scheme: 'deck-terminal',
        path: '/work/beta-main/term-1',
      },
      'deck.terminal',
      { viewColumn: -1 },
    );
    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });
});
