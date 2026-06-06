import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  createTerminal: vi.fn(() => ({ show: vi.fn() })),
  workspaceFolders: [{ uri: { fsPath: '/work/alpha-main' } }],
  windowTerminals: [] as unknown[],
}));

vi.mock('vscode', () => ({
  ViewColumn: { Active: -1 },
  window: {
    createTerminal: vscodeState.createTerminal,
    get terminals() {
      return vscodeState.windowTerminals;
    },
  },
  workspace: {
    workspaceFolders: vscodeState.workspaceFolders,
  },
}));

import { OpenTerminalCommand } from '../src/terminal/openTerminalCommand';
import { TerminalSessionRegistry } from '../src/terminal/terminalSessionRegistry';

describe('OpenTerminalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main' } }];
    vscodeState.windowTerminals = [];
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
      n: 1,
      worktreePath: '/work/alpha-main',
    });

    expect(vscodeState.createTerminal).toHaveBeenCalledWith({
      name: '1 zsh',
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
      n: 1,
      worktreePath: '/work/alpha-main',
    });

    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
    expect(terminal.show).toHaveBeenCalledWith(false);
  });

  it('reuses a restored editor terminal already attached to the target session', async () => {
    const tmux = {
      attachShellArgs: vi.fn(() => ['-L', 'deck', 'attach-session', '-t', '=wt-_work_repo__term-1']),
    };
    const restored = {
      show: vi.fn(),
      creationOptions: {
        shellArgs: ['-L', 'deck', 'attach-session', '-t', '=wt-_work_repo__term-1'],
      },
    };
    vscodeState.windowTerminals = [restored];
    const registry = new TerminalSessionRegistry();

    await new OpenTerminalCommand(tmux, registry).run({
      terminal: { sessionName: 'wt-_work_repo__term-1', windowName: 'zsh' },
      n: 1,
      worktreePath: '/work/alpha-main',
    });

    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
    expect(restored.show).toHaveBeenCalledWith(false);
    expect(registry.get('wt-_work_repo__term-1')).toBe(restored);
  });

  it('stores a pending intent and switches worktree for cross-worktree terminal clicks', async () => {
    const tmux = {
      attachShellArgs: vi.fn(),
    };
    const registry = new TerminalSessionRegistry();
    const pendingTerminalOpens = {
      set: vi.fn(async () => undefined),
    };
    const switcher = {
      switchTo: vi.fn(async () => undefined),
    };

    await new OpenTerminalCommand(tmux, registry, { pendingTerminalOpens, switcher }).run({
      terminal: { sessionName: 'wt-_work_beta-main__term-1', windowName: 'zsh' },
      n: 1,
      worktreePath: '/work/beta-main',
    });

    expect(pendingTerminalOpens.set).toHaveBeenCalledWith(
      '/work/beta-main',
      'wt-_work_beta-main__term-1',
    );
    expect(switcher.switchTo).toHaveBeenCalledWith('/work/beta-main');
    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
  });
});
