import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  executeCommand: vi.fn(),
}));

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vscodeState.executeCommand,
  },
  Uri: {
    file: vi.fn((fsPath: string) => ({ fsPath })),
  },
}));

import * as vscode from 'vscode';
import { DetachedOpener } from '../src/switch/detachedOpener';

function createOpener() {
  const activeWorktrees = {
    set: vi.fn(async () => undefined),
  };

  return {
    activeWorktrees,
    opener: new DetachedOpener(),
  };
}

describe('DetachedOpener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the Worktree in a new window', async () => {
    const { opener } = createOpener();

    await opener.open('/repo/feature');

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openFolder',
      { fsPath: '/repo/feature' },
      { forceNewWindow: true },
    );
  });

  it('does not mutate the current window ActiveWorktree', async () => {
    const { activeWorktrees, opener } = createOpener();

    await opener.open('/repo/feature');

    expect(activeWorktrees.set).not.toHaveBeenCalled();
  });
});
