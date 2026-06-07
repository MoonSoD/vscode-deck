import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  createTerminal: vi.fn(() => ({ show: vi.fn() })),
  executeCommand: vi.fn(async () => undefined),
  workspaceFolders: [{ uri: { fsPath: '/work/alpha-main' } }],
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
    workspaceFolders: vscodeState.workspaceFolders,
  },
}));

import { OpenTerminalCommand } from '../src/terminal/openTerminalCommand';

describe('OpenTerminalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/alpha-main' } }];
  });

  it('opens a same-worktree terminal row as a Deck custom editor', async () => {
    await new OpenTerminalCommand().run({
      terminal: { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      n: 1,
      worktreePath: '/work/alpha-main',
    });

    expect(vscodeState.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      {
        scheme: 'deck-terminal',
        authority: 'session',
        path: '/wt-_work_alpha-main__term-1',
        query: 'cwd=%2Fwork%2Falpha-main',
      },
      'deck.terminal',
      { viewColumn: -1 },
    );
    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
  });

  it('focuses an existing custom-editor tab on re-click', async () => {
    const panel = { reveal: vi.fn() };
    const terminalPanels = {
      panelFor: vi.fn(() => panel),
    };

    await new OpenTerminalCommand({ terminalPanels }).run({
      terminal: { sessionName: 'wt-_work_alpha-main__term-1', windowName: 'zsh' },
      n: 1,
      worktreePath: '/work/alpha-main',
    });

    expect(terminalPanels.panelFor).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');
    expect(panel.reveal).toHaveBeenCalledWith();
    expect(vscodeState.executeCommand).not.toHaveBeenCalled();
    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
  });

  it('stores a pending intent and switches worktree for cross-worktree terminal clicks', async () => {
    const pendingTerminalOpens = {
      set: vi.fn(async () => undefined),
    };
    const switcher = {
      switchTo: vi.fn(async () => undefined),
    };

    await new OpenTerminalCommand({ pendingTerminalOpens, switcher }).run({
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
    expect(vscodeState.executeCommand).not.toHaveBeenCalled();
  });
});
