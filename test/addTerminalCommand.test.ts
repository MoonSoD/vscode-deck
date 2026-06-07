import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  createTerminal: vi.fn(() => ({ show: vi.fn() })),
  workspaceFolders: [{ uri: { fsPath: '/work/repo' } }],
}));

vi.mock('vscode', () => ({
  ViewColumn: { Active: -1 },
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
import { TerminalSessionRegistry } from '../src/terminal/terminalSessionRegistry';

describe('AddTerminalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/repo' } }];
  });

  it('allocates the next terminal in tmux and opens it in editor view focused', async () => {
    const existing = [
      { sessionName: 'wt-_work_repo__term-1', windowName: 'zsh' },
      { sessionName: 'wt-_work_repo__term-3', windowName: 'claude' },
    ];
    const tmux = {
      // First call returns existing; second call (post-create) returns
      // the existing plus the new session with whatever name tmux assigned
      // (we don't set -n anymore, so tmux defaults to the shell name).
      listSessions: vi
        .fn()
        .mockResolvedValueOnce(existing)
        .mockResolvedValueOnce([
          ...existing,
          { sessionName: 'wt-_work_repo__term-4', windowName: 'zsh' },
        ]),
      ensureSession: vi.fn(async () => undefined),
      attachShellArgs: vi.fn(() => [
        '-L',
        'deck',
        '-f',
        '/ext/resources/deck.conf',
        'attach-session',
        '-t',
        '=wt-_work_repo__term-4',
      ]),
    };
    const terminal = { show: vi.fn(), processId: Promise.resolve(1234) };
    vscodeState.createTerminal.mockReturnValue(terminal);
    const registry = new TerminalSessionRegistry();
    const refresh = vi.fn();
    const terminalSessionListCache = {
      set: vi.fn(async () => undefined),
    };
    const pidStore = { set: vi.fn(async () => undefined) };

    await new AddTerminalCommand(
      tmux,
      registry,
      refresh,
      terminalSessionListCache,
      { pidStore },
    ).run({ worktree: { path: '/work/repo' } });

    expect(tmux.ensureSession).toHaveBeenCalledWith(
      'wt-_work_repo__term-4',
      '/work/repo',
    );
    expect(vscodeState.createTerminal).toHaveBeenCalledWith({
      name: '4 zsh',
      cwd: '/work/repo',
      shellPath: 'tmux',
      shellArgs: [
        '-L',
        'deck',
        '-f',
        '/ext/resources/deck.conf',
        'attach-session',
        '-t',
        '=wt-_work_repo__term-4',
      ],
      location: { viewColumn: -1 },
    });
    expect(terminal.show).toHaveBeenCalledWith(false);
    expect(registry.get('wt-_work_repo__term-4')).toBe(terminal);
    expect(pidStore.set).toHaveBeenCalledWith('wt-_work_repo__term-4', 1234);
    expect(terminalSessionListCache.set).toHaveBeenCalledWith('wt-_work_repo__', [
      { sessionName: 'wt-_work_repo__term-1', n: 1, windowName: 'zsh' },
      { sessionName: 'wt-_work_repo__term-3', n: 3, windowName: 'claude' },
      { sessionName: 'wt-_work_repo__term-4', n: 4, windowName: 'zsh' },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('creates the tmux session, stores a pending intent, and switches for cross-worktree adds', async () => {
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main' } }];
    const tmux = {
      listSessions: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          { sessionName: 'wt-_work_beta-main__term-1', windowName: 'zsh' },
        ]),
      ensureSession: vi.fn(async () => undefined),
      attachShellArgs: vi.fn(),
    };
    const registry = new TerminalSessionRegistry();
    const refresh = vi.fn();
    const terminalSessionListCache = { set: vi.fn(async () => undefined) };
    const pendingTerminalOpens = { set: vi.fn(async () => undefined) };
    const switcher = { switchTo: vi.fn(async () => undefined) };

    await new AddTerminalCommand(
      tmux,
      registry,
      refresh,
      terminalSessionListCache,
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
    expect(refresh).not.toHaveBeenCalled();
  });
});
