import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
  },
}));

import { handleBranchDeletionRefusal } from '../src/worktree/keptBranch';

describe('handleBranchDeletionRefusal', () => {
  it('shows a KeptBranch warning when git cannot confirm commits are merged', async () => {
    const deps = {
      git: {
        readBranchTip: vi.fn(async () => 'abc123'),
        deleteBranch: vi.fn(async () => undefined),
      },
      notifications: {
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(async () => undefined),
      },
    };

    await handleBranchDeletionRefusal(
      {
        repositoryPath: '/repo/main',
        branchName: 'test-21',
        error: { stderr: "error: the branch 'test-21' is not fully merged" },
      },
      deps,
    );

    expect(deps.notifications.showWarningMessage).toHaveBeenCalledWith(
      "Worktree removed — branch 'test-21' kept: git could not confirm its commits are merged.",
      'Force Delete Branch',
    );
    expect(deps.notifications.showErrorMessage).not.toHaveBeenCalled();
  });

  it('force-deletes the branch when the toast action is clicked and the tip is unchanged', async () => {
    const picked = deferred<string | undefined>();
    const deps = {
      git: {
        readBranchTip: vi.fn(async () => 'abc123'),
        deleteBranch: vi.fn(async () => undefined),
      },
      notifications: {
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(() => picked.promise),
      },
    };

    await handleBranchDeletionRefusal(
      {
        repositoryPath: '/repo/main',
        branchName: 'feature',
        error: { stderr: "error: the branch 'feature' is not fully merged" },
      },
      deps,
    );

    picked.resolve('Force Delete Branch');
    await waitUntil(() => deps.notifications.showInformationMessage.mock.calls.length > 0);

    expect(deps.git.readBranchTip).toHaveBeenCalledTimes(2);
    expect(deps.git.deleteBranch).toHaveBeenCalledWith('/repo/main', 'feature', {
      force: true,
    });
    expect(deps.notifications.showInformationMessage).toHaveBeenCalledWith(
      "Branch 'feature' deleted.",
    );
  });

  it('keeps the branch when the toast action is clicked after the branch moved', async () => {
    const picked = deferred<string | undefined>();
    const deps = {
      git: {
        readBranchTip: vi
          .fn()
          .mockResolvedValueOnce('abc123')
          .mockResolvedValueOnce('def456'),
        deleteBranch: vi.fn(async () => undefined),
      },
      notifications: {
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(() => picked.promise),
      },
    };

    await handleBranchDeletionRefusal(
      {
        repositoryPath: '/repo/main',
        branchName: 'feature',
        error: { stderr: "error: the branch 'feature' is not fully merged" },
      },
      deps,
    );

    picked.resolve('Force Delete Branch');
    await waitUntil(() => deps.notifications.showWarningMessage.mock.calls.length > 1);

    expect(deps.git.deleteBranch).not.toHaveBeenCalled();
    expect(deps.notifications.showWarningMessage).toHaveBeenLastCalledWith(
      "Branch 'feature' has new commits since Deck kept it — review it before deleting.",
    );
  });

  it('shows an error when the guarded force delete fails', async () => {
    const picked = deferred<string | undefined>();
    const deps = {
      git: {
        readBranchTip: vi.fn(async () => 'abc123'),
        deleteBranch: vi.fn(async () => {
          throw { stderr: 'branch is checked out in another worktree' };
        }),
      },
      notifications: {
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(() => picked.promise),
      },
    };

    await handleBranchDeletionRefusal(
      {
        repositoryPath: '/repo/main',
        branchName: 'feature',
        error: { stderr: "error: the branch 'feature' is not fully merged" },
      },
      deps,
    );

    picked.resolve('Force Delete Branch');
    await waitUntil(() => deps.notifications.showErrorMessage.mock.calls.length > 0);

    expect(deps.notifications.showErrorMessage).toHaveBeenCalledWith(
      'Cannot delete branch: branch is checked out in another worktree',
    );
  });

  it('keeps non-UnmergedCommits branch deletion errors on the generic error path', async () => {
    const deps = {
      git: {
        readBranchTip: vi.fn(async () => 'abc123'),
        deleteBranch: vi.fn(async () => undefined),
      },
      notifications: {
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(async () => undefined),
      },
    };

    await handleBranchDeletionRefusal(
      {
        repositoryPath: '/repo/main',
        branchName: 'feature',
        error: { stderr: "error: cannot delete branch 'feature' checked out at '/repo/other'" },
      },
      deps,
    );

    expect(deps.notifications.showErrorMessage).toHaveBeenCalledWith(
      "Cannot delete branch: error: cannot delete branch 'feature' checked out at '/repo/other'",
    );
    expect(deps.notifications.showWarningMessage).not.toHaveBeenCalled();
    expect(deps.git.readBranchTip).not.toHaveBeenCalled();
  });

  it('does not force-delete when the KeptBranch toast is dismissed', async () => {
    const deps = {
      git: {
        readBranchTip: vi.fn(async () => 'abc123'),
        deleteBranch: vi.fn(async () => undefined),
      },
      notifications: {
        showErrorMessage: vi.fn(),
        showInformationMessage: vi.fn(),
        showWarningMessage: vi.fn(async () => undefined),
      },
    };

    await handleBranchDeletionRefusal(
      {
        repositoryPath: '/repo/main',
        branchName: 'feature',
        error: { stderr: "error: the branch 'feature' is not fully merged" },
      },
      deps,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(deps.git.readBranchTip).toHaveBeenCalledOnce();
    expect(deps.git.deleteBranch).not.toHaveBeenCalled();
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function waitUntil(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('condition was not met');
}
