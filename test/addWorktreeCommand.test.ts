import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInputBox: vi.fn(),
    showQuickPick: vi.fn(),
  },
}));

vi.mock('../src/git/worktrees', () => ({
  addWorktree: vi.fn(async () => undefined),
  listBranches: vi.fn(async () => ['main', 'feature/foo']),
}));

import * as vscode from 'vscode';
import { addWorktree, listBranches } from '../src/git/worktrees';
import { AddWorktreeCommand } from '../src/worktree/addWorktreeCommand';

describe('AddWorktreeCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates an existing-branch worktree and switches to it', async () => {
    const switcher = { switchTo: vi.fn(async () => undefined) };
    const command = new AddWorktreeCommand(switcher);

    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      const picks = items as Array<{ branch?: string }>;
      return picks.find((item) => item.branch === 'feature/foo');
    });
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(
      '/work/myrepo-feature-foo',
    );

    await command.run({ projectPath: '/work/myrepo' });

    expect(listBranches).toHaveBeenCalledWith('/work/myrepo');
    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'Worktree path',
        value: '/work/myrepo-feature-foo',
      }),
    );
    expect(addWorktree).toHaveBeenCalledWith('/work/myrepo', {
      path: '/work/myrepo-feature-foo',
      branch: 'feature/foo',
    });
    expect(switcher.switchTo).toHaveBeenCalledWith('/work/myrepo-feature-foo');
  });

  it('creates a new-branch worktree from the chosen base ref', async () => {
    const switcher = { switchTo: vi.fn(async () => undefined) };
    const command = new AddWorktreeCommand(switcher);

    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      const picks = items as Array<{ action?: string }>;
      return picks.find((item) => item.action === 'create');
    });
    vi.mocked(vscode.window.showInputBox)
      .mockResolvedValueOnce('feature/bar')
      .mockResolvedValueOnce('main')
      .mockResolvedValueOnce('/work/myrepo-feature-bar');

    await command.run({ projectPath: '/work/myrepo' });

    expect(addWorktree).toHaveBeenCalledWith('/work/myrepo', {
      path: '/work/myrepo-feature-bar',
      newBranch: 'feature/bar',
      baseRef: 'main',
    });
    expect(switcher.switchTo).toHaveBeenCalledWith('/work/myrepo-feature-bar');
  });

  it('does nothing when branch picking is cancelled', async () => {
    const switcher = { switchTo: vi.fn(async () => undefined) };
    const command = new AddWorktreeCommand(switcher);

    vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

    await command.run({ projectPath: '/work/myrepo' });

    expect(addWorktree).not.toHaveBeenCalled();
    expect(switcher.switchTo).not.toHaveBeenCalled();
  });

  it('surfaces git failures and does not switch', async () => {
    const switcher = { switchTo: vi.fn(async () => undefined) };
    const command = new AddWorktreeCommand(switcher);

    vi.mocked(vscode.window.showQuickPick).mockImplementation(async (items) => {
      const picks = items as Array<{ branch?: string }>;
      return picks.find((item) => item.branch === 'feature/foo');
    });
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(
      '/work/myrepo-feature-foo',
    );
    vi.mocked(addWorktree).mockRejectedValueOnce({ stderr: 'path already exists' });

    await command.run({ projectPath: '/work/myrepo' });

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Cannot create worktree: path already exists',
    );
    expect(switcher.switchTo).not.toHaveBeenCalled();
  });
});
