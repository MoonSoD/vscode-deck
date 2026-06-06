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
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_work_repo__term-1', windowName: 'zsh' },
        { sessionName: 'wt-_work_repo__term-3', windowName: 'claude' },
      ]),
      ensureSessionWindow: vi.fn(async () => undefined),
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

    await new AddTerminalCommand(tmux, registry, refresh).run({
      worktree: { path: '/work/repo' },
    });

    expect(tmux.ensureSessionWindow).toHaveBeenCalledWith(
      'wt-_work_repo__term-4',
      'term-4',
      '/work/repo',
    );
    expect(vscodeState.createTerminal).toHaveBeenCalledWith({
      name: 'Deck term-4',
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
    expect(terminal.show).toHaveBeenCalledWith(true);
    expect(registry.get('wt-_work_repo__term-4')).toBe(terminal);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
