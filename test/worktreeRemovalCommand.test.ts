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
  deleteBranch: vi.fn(async () => undefined),
}));

import * as vscode from 'vscode';
import { deleteBranch, getCommonDir, getWorktreeStatus, removeWorktree } from '../src/git/worktrees';
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
    vi.mocked(deleteBranch).mockResolvedValue(undefined);
  });

  it('removes the worktree without deleting the branch when keep-branch is accepted', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const branchDeletionPreferences = {
      get: vi.fn(() => false),
      set: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      refresh,
      branchDeletionPreferences,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );

    await command.run(node);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Remove worktree at `/repo/feature`?',
      { modal: true, detail: undefined },
      'Remove (keep branch)',
      'Remove and delete branch',
    );
    expect(branchDeletionPreferences.set).toHaveBeenCalledOnce();
    expect(branchDeletionPreferences.set).toHaveBeenCalledWith(false);
    expect(removeWorktree).toHaveBeenCalledWith('/repo/main', '/repo/feature', {
      force: false,
    });
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(activeWorktrees.clear).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('kills matching Deck terminal sessions before removing the worktree', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const terminalCascade = {
      killWorktree: vi.fn(async () => undefined),
    };
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      vi.fn(),
      undefined,
      undefined,
      undefined,
      terminalCascade,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );

    await command.run(node);

    expect(terminalCascade.killWorktree).toHaveBeenCalledWith('/repo/feature');
    expect(terminalCascade.killWorktree.mock.invocationCallOrder[0]).toBeLessThan(
      removeWorktree.mock.invocationCallOrder[0],
    );
  });

  it('continues removing the worktree when terminal cascade fails', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const terminalCascade = {
      killWorktree: vi.fn(async () => {
        throw new Error('tmux socket busy');
      }),
    };
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      vi.fn(),
      undefined,
      undefined,
      undefined,
      terminalCascade,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );

    await command.run(node);

    expect(removeWorktree).toHaveBeenCalledWith('/repo/main', '/repo/feature', {
      force: false,
    });
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalledWith(
      'Cannot remove worktree: tmux socket busy',
    );
  });

  it('updates the worktree-list cache after successful removal', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const worktreeListCache = {
      remove: vi.fn(async () => undefined),
    };
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      refresh,
      undefined,
      worktreeListCache,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );

    await command.run(node);

    expect(worktreeListCache.remove).toHaveBeenCalledWith('/git/repo', '/repo/feature');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('removes the worktree and then deletes the branch when accepted', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const branchDeletionPreferences = {
      get: vi.fn(() => true),
      set: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      refresh,
      branchDeletionPreferences,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove and delete branch' as never,
    );

    await command.run(node);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Remove worktree at `/repo/feature`?',
      { modal: true, detail: undefined },
      'Remove and delete branch',
      'Remove (keep branch)',
    );
    expect(branchDeletionPreferences.set).toHaveBeenCalledOnce();
    expect(branchDeletionPreferences.set).toHaveBeenCalledWith(true);
    expect(branchDeletionPreferences.set.mock.invocationCallOrder[0]).toBeLessThan(
      removeWorktree.mock.invocationCallOrder[0],
    );
    expect(removeWorktree).toHaveBeenCalledWith('/repo/main', '/repo/feature', {
      force: false,
    });
    expect(deleteBranch).toHaveBeenCalledWith('/repo/main', 'feature');
    expect(removeWorktree.mock.invocationCallOrder[0]).toBeLessThan(
      deleteBranch.mock.invocationCallOrder[0],
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does nothing when confirmation is cancelled', async () => {
    const activeWorktrees = {
      get: vi.fn(() => '/repo/feature'),
      clear: vi.fn(async () => undefined),
    };
    const branchDeletionPreferences = {
      get: vi.fn(() => true),
      set: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      refresh,
      branchDeletionPreferences,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(undefined);

    await command.run(node);

    expect(branchDeletionPreferences.set).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
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

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );
    vi.mocked(removeWorktree).mockRejectedValueOnce({ stderr: 'is dirty' });

    await command.run(node);

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Cannot remove worktree: is dirty',
    );
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(activeWorktrees.clear).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('surfaces branch deletion failures after removing the worktree', async () => {
    const activeWorktrees = {
      get: vi.fn(() => '/repo/feature'),
      clear: vi.fn(async () => undefined),
    };
    const branchDeletionPreferences = {
      get: vi.fn(() => true),
      set: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      refresh,
      branchDeletionPreferences,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove and delete branch' as never,
    );
    vi.mocked(deleteBranch).mockRejectedValueOnce({ stderr: 'not fully merged' });

    await command.run(node);

    expect(removeWorktree).toHaveBeenCalledOnce();
    expect(deleteBranch).toHaveBeenCalledWith('/repo/main', 'feature');
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Cannot delete branch: not fully merged',
    );
    expect(activeWorktrees.clear).toHaveBeenCalledWith('/git/repo');
    expect(refresh).toHaveBeenCalledOnce();
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

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Remove (keep branch)' as never,
    );

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
    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue(
      'Force Remove (keep branch)' as never,
    );

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
      'Force Remove (keep branch)',
      'Force Remove and delete branch',
    );
    expect(removeWorktree).toHaveBeenCalledWith('/repo/main', '/repo/feature', {
      force: true,
    });
  });

  it('hides branch deletion for detached worktrees', async () => {
    const activeWorktrees = {
      get: vi.fn(() => undefined),
      clear: vi.fn(async () => undefined),
    };
    const branchDeletionPreferences = {
      get: vi.fn(() => true),
      set: vi.fn(async () => undefined),
    };
    const command = new WorktreeRemovalCommand(
      activeWorktrees,
      vi.fn(),
      branchDeletionPreferences,
    );

    vi.mocked(vscode.window.showWarningMessage).mockResolvedValue('Remove' as never);

    await command.run({
      ...node,
      worktree: {
        ...node.worktree,
        branch: undefined,
        detached: true,
      },
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Remove worktree at `/repo/feature`?',
      { modal: true, detail: undefined },
      'Remove',
    );
    expect(branchDeletionPreferences.set).not.toHaveBeenCalled();
    expect(deleteBranch).not.toHaveBeenCalled();
    expect(removeWorktree).toHaveBeenCalledOnce();
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
    );
    expect(getWorktreeStatus).not.toHaveBeenCalled();
    expect(removeWorktree).not.toHaveBeenCalled();
  });
});
