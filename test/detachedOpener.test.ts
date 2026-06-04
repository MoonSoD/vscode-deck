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
import { ActiveWorktreeStore } from '../src/switch/activeWorktreeStore';
import { DetachedOpener } from '../src/switch/detachedOpener';

function createOpener() {
  const activeWorktrees = {
    set: vi.fn(async () => undefined),
    setFocusIntent: vi.fn(async () => undefined),
  } as unknown as ActiveWorktreeStore;

  return {
    activeWorktrees,
    opener: new DetachedOpener(activeWorktrees),
  };
}

describe('DetachedOpener', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('opens the Worktree in a new window and focuses Deck there', async () => {
    const { activeWorktrees, opener } = createOpener();

    await opener.open('/repo/feature');

    expect(activeWorktrees.setFocusIntent).toHaveBeenCalledWith(true);
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
