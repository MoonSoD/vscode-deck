import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  createTerminal: vi.fn(),
  executeCommand: vi.fn(),
}));

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vscodeState.executeCommand,
  },
  Uri: {
    file: vi.fn((fsPath: string) => ({ fsPath })),
  },
  window: {
    createTerminal: vscodeState.createTerminal,
  },
}));

import * as vscode from 'vscode';
import { OpenTerminalInNewWindowCommand } from '../src/terminal/openTerminalInNewWindowCommand';

describe('OpenTerminalInNewWindowCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores a pending intent and opens the worktree folder in a new window', async () => {
    const pendingTerminalOpens = {
      set: vi.fn(async () => undefined),
    };

    await new OpenTerminalInNewWindowCommand(pendingTerminalOpens).run({
      terminal: { sessionName: 'wt-_work_beta-main__term-1', windowName: 'zsh' },
      n: 1,
      worktreePath: '/work/beta-main',
    });

    expect(pendingTerminalOpens.set).toHaveBeenCalledWith(
      '/work/beta-main',
      'wt-_work_beta-main__term-1',
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openFolder',
      { fsPath: '/work/beta-main' },
      { forceNewWindow: true },
    );
    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
  });
});
