import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/repo/main' } }],
  },
}));

vi.mock('../src/git/worktrees', () => ({
  getCommonDir: vi.fn(async () => '/git/repo'),
  getWorktreeStatus: vi.fn(async () => ({
    hasChanges: false,
    hasUnpushedCommits: false,
  })),
  removeWorktree: vi.fn(async () => undefined),
}));

import * as vscode from 'vscode';
import { getCommonDir, getWorktreeStatus, removeWorktree } from '../src/git/worktrees';
import { WorktreeRemovalCommand } from '../src/worktree/worktreeRemovalCommand';

const node = {
  projectPath: '/repo/main',
  mainWorktreePath: '/repo/main',
  worktree: {
    path: '/repo/feature',
    head: 'abc',
    bare: false,
    detached: false,
    branch: 'feature',
  },
};

describe('WorktreeRemovalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getCommonDir).mockResolvedValue('/git/repo');
    vi.mocked(getWorktreeStatus).mockResolvedValue({
      hasChanges: false,
      hasUnpushedCommits: false,
    });
    vi.mocked(removeWorktree).mockResolvedValue(undefined);
  });

  it('removes the worktree only after confirmation', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(activeWorktrees, refresh);

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Remove' as never);

    await command.run(node);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Remove worktree at `/repo/feature`?',
      { modal: true, detail: undefined },
      'Cancel',
      'Remove',
    );
    expect(removeWorktree).toHaveBeenCalledWith('/repo/main', '/repo/feature', {
      force: false,
    });
    expect(activeWorktrees.clear).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does nothing when confirmation is cancelled', async () => {
    const activeWorktrees = {
      get: vi.fn(() => '/repo/feature'),
      clear: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(activeWorktrees, refresh);

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    await command.run(node);

    expect(removeWorktree).not.toHaveBeenCalled();
    expect(activeWorktrees.clear).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('surfaces remove failures without cleanup or refresh', async () => {
    const activeWorktrees = {
      get: vi.fn(() => '/repo/feature'),
      clear: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(activeWorktrees, refresh);

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Remove' as never);
    vi.mocked(removeWorktree).mockRejectedValueOnce({ stderr: 'is dirty' });

    await command.run(node);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Cannot remove worktree: is dirty',
    );
    expect(activeWorktrees.clear).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('surfaces status failures without removing', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(activeWorktrees, refresh);

    vi.mocked(getWorktreeStatus).mockRejectedValueOnce({ stderr: 'not a git repo' });

    await command.run(node);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Cannot inspect worktree: not a git repo',
    );
    expect(vscode.window.showWarningMessage).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('clears the ActiveWorktree entry only when it points at the deleted path', async () => {
    const activeWorktrees = {
      get: vi.fn(() => '/repo/feature'),
      clear: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(activeWorktrees, refresh);

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Remove' as never);

    await command.run(node);

    expect(activeWorktrees.clear).toHaveBeenCalledWith('/git/repo');

    activeWorktrees.get.mockReturnValue('/repo/other');
    activeWorktrees.clear.mockClear();
    refresh.mockClear();

    await command.run(node);

    expect(activeWorktrees.clear).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('uses force when the worktree is dirty or locked', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const command = new WorktreeRemovalCommand(activeWorktrees, vi.fn());

    vi.mocked(getWorktreeStatus).mockResolvedValue({
      hasChanges: true,
      hasUnpushedCommits: true,
    });
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Force Remove' as never);

    await command.run({
      ...node,
      worktree: {
        ...node.worktree,
        locked: true,
      },
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Remove worktree at `/repo/feature`?',
      {
        modal: true,
        detail:
          'Warning: this worktree has uncommitted changes, unpushed commits, locked worktree.',
      },
      'Cancel',
      'Force Remove',
    );
    expect(removeWorktree).toHaveBeenCalledWith('/repo/main', '/repo/feature', {
      force: true,
    });
  });

  it('shows the structural reason and does not call git for active or main worktrees', async () => {
    const command = new WorktreeRemovalCommand(
      {
        get: vi.fn(() => undefined),
        clear: vi.fn(async () => undefined),
      },
      vi.fn(),
    );

    await command.run({
      ...node,
      worktree: {
        ...node.worktree,
        path: '/repo/main',
      },
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Remove worktree at `/repo/main`?',
      { modal: true, detail: 'Switch to another worktree first.' },
      'Cancel',
    );
    expect(getWorktreeStatus).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
  });
});
