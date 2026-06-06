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

describe('AddTerminalCommand', () => {
  it('creates term-1 in tmux and opens it in editor view focused', async () => {
    const tmux = {
      ensureSessionWindow: vi.fn(async () => undefined),
      attachShellArgs: vi.fn(() => [
        '-L',
        'deck',
        '-f',
        '/ext/resources/deck.conf',
        'attach-session',
        '-t',
        '=wt-_work_repo__term-1',
      ]),
    };
    const terminal = { show: vi.fn() };
    vscodeState.createTerminal.mockReturnValue(terminal);

    await new AddTerminalCommand(tmux).run({
      worktree: { path: '/work/repo' },
    });

    expect(tmux.ensureSessionWindow).toHaveBeenCalledWith(
      'wt-_work_repo__term-1',
      'term-1',
      '/work/repo',
    );
    expect(vscodeState.createTerminal).toHaveBeenCalledWith({
      name: 'Deck term-1',
      shellPath: 'tmux',
      shellArgs: [
        '-L',
        'deck',
        '-f',
        '/ext/resources/deck.conf',
        'attach-session',
        '-t',
        '=wt-_work_repo__term-1',
      ],
      location: { viewColumn: -1 },
    });
    expect(terminal.show).toHaveBeenCalledWith(true);
  });
});
