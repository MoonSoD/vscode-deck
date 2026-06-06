import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  createTerminal: vi.fn(() => ({ show: vi.fn() })),
}));

vi.mock('vscode', () => ({
  ViewColumn: { Active: -1 },
  window: {
    createTerminal: vscodeState.createTerminal,
  },
}));

import { OpenTerminalCommand } from '../src/terminal/openTerminalCommand';
import { TerminalSessionRegistry } from '../src/terminal/terminalSessionRegistry';

describe('OpenTerminalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('attaches a new editor terminal on registry miss', async () => {
    const tmux = {
      attachShellArgs: vi.fn(() => ['attach-session', '-t', '=wt-_work_repo__term-1']),
    };
    const terminal = { show: vi.fn() };
    vscodeState.createTerminal.mockReturnValue(terminal);
    const registry = new TerminalSessionRegistry();

    await new OpenTerminalCommand(tmux, registry).run({
      terminal: { sessionName: 'wt-_work_repo__term-1', windowName: 'zsh' },
    });

    expect(vscodeState.createTerminal).toHaveBeenCalledWith({
      name: 'Deck zsh',
      shellPath: 'tmux',
      shellArgs: ['attach-session', '-t', '=wt-_work_repo__term-1'],
      location: { viewColumn: -1 },
    });
    expect(terminal.show).toHaveBeenCalledWith(false);
    expect(registry.get('wt-_work_repo__term-1')).toBe(terminal);
  });

  it('focuses the existing editor terminal on registry hit', async () => {
    const tmux = {
      attachShellArgs: vi.fn(),
    };
    const terminal = { show: vi.fn() };
    const registry = new TerminalSessionRegistry();
    registry.set('wt-_work_repo__term-1', terminal);

    await new OpenTerminalCommand(tmux, registry).run({
      terminal: { sessionName: 'wt-_work_repo__term-1', windowName: 'zsh' },
    });

    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
    expect(terminal.show).toHaveBeenCalledWith(false);
  });
});
