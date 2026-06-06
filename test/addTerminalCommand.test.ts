import { describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  createTerminal: vi.fn(() => ({ show: vi.fn() })),
}));

vi.mock('vscode', () => ({
  ViewColumn: { Active: -1 },
  window: {
    createTerminal: vscodeState.createTerminal,
  },
}));

import { AddTerminalCommand } from '../src/terminal/addTerminalCommand';
import { TerminalSessionRegistry } from '../src/terminal/terminalSessionRegistry';

describe('AddTerminalCommand', () => {
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
    const terminal = { show: vi.fn() };
    vscodeState.createTerminal.mockReturnValue(terminal);
    const registry = new TerminalSessionRegistry();
    const refresh = vi.fn();
    const terminalSessionListCache = {
      set: vi.fn(async () => undefined),
    };

    await new AddTerminalCommand(tmux, registry, refresh, terminalSessionListCache).run({
      worktree: { path: '/work/repo' },
    });

    expect(tmux.ensureSession).toHaveBeenCalledWith(
      'wt-_work_repo__term-4',
      '/work/repo',
    );
    expect(vscodeState.createTerminal).toHaveBeenCalledWith({
      name: '4 zsh',
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
    expect(terminalSessionListCache.set).toHaveBeenCalledWith('wt-_work_repo__', [
      { sessionName: 'wt-_work_repo__term-1', n: 1, windowName: 'zsh' },
      { sessionName: 'wt-_work_repo__term-3', n: 3, windowName: 'claude' },
      { sessionName: 'wt-_work_repo__term-4', n: 4, windowName: 'zsh' },
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
