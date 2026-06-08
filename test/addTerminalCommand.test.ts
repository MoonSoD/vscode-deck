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
        authority: 'session',
        path: '/wt-_work_repo__term-4',
        query: 'cwd=%2Fwork%2Frepo',
      },
      'deck.terminal',
      { viewColumn: -1 },
    );
    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('creates the tmux session, stores a pending intent, and switches for cross-worktree adds', async () => {
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main' } }];
    const tmux = {
      listSessions: vi.fn().mockResolvedValueOnce([]),
      ensureSession: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const pendingTerminalOpens = { set: vi.fn(async () => undefined) };
    const switcher = { switchTo: vi.fn(async () => undefined) };

    await new AddTerminalCommand(
      tmux,
      refresh,
      { pendingTerminalOpens, switcher },
    ).run({ worktree: { path: '/work/beta-main' } });

    expect(tmux.ensureSession).toHaveBeenCalledWith(
      'wt-_work_beta-main__term-1',
      '/work/beta-main',
    );
    expect(pendingTerminalOpens.set).toHaveBeenCalledWith(
      '/work/beta-main',
      'wt-_work_beta-main__term-1',
    );
    expect(switcher.switchTo).toHaveBeenCalledWith('/work/beta-main');
    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
    expect(vscodeState.executeCommand).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
