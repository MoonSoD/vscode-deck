import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  calls: [] as string[],
  executeCommand: vi.fn(async () => {
    state.calls.push('openFolder');
  }),
  getCommonDir: vi.fn(async () => '/repo/.git/worktrees/feature'),
}));

vi.mock('vscode', () => ({
  commands: {
    executeCommand: state.executeCommand,
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
}));

vi.mock('../src/git/worktrees', () => ({
  getCommonDir: state.getCommonDir,
}));

import { WorktreeSwitcher } from '../src/switch/worktreeSwitcher';

describe('WorktreeSwitcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.calls = [];
  });

  it('persists the active worktree before switching folders', async () => {
    const activeWorktrees = {
      set: vi.fn(async () => {
        state.calls.push('setActive');
      }),
    };

    await new WorktreeSwitcher(activeWorktrees).switchTo('/repo/feature');

    expect(state.getCommonDir).toHaveBeenCalledWith('/repo/feature');
    expect(activeWorktrees.set).toHaveBeenCalledWith('/repo/.git/worktrees/feature', '/repo/feature');
    expect(state.executeCommand).toHaveBeenCalledWith(
      'vscode.openFolder',
      { fsPath: '/repo/feature' },
      { forceNewWindow: false },
    );
    // set must persist before the reload so post-reload activation sees it
    expect(state.calls).toEqual(['setActive', 'openFolder']);
  });
});
