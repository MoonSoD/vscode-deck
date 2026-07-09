import * as vscode from 'vscode';
import { deleteBranch, readBranchTip } from '../git/worktrees';

export interface BranchDeletionRefusal {
  repositoryPath: string;
  branchName: string;
  error: unknown;
}

interface KeptBranchGitLike {
  readBranchTip(repositoryPath: string, branchName: string): Promise<string>;
  deleteBranch(
    repositoryPath: string,
    branchName: string,
    options: { force?: boolean },
  ): Promise<void>;
}

interface KeptBranchNotificationsLike {
  showErrorMessage(message: string): unknown;
  showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
}

interface KeptBranchDeps {
  git: KeptBranchGitLike;
  notifications: KeptBranchNotificationsLike;
}

const FORCE_DELETE_BRANCH = 'Force Delete Branch';

const defaultDeps: KeptBranchDeps = {
  git: { readBranchTip, deleteBranch },
  notifications: vscode.window,
};

export async function handleBranchDeletionRefusal(
  request: BranchDeletionRefusal,
  deps: KeptBranchDeps = defaultDeps,
): Promise<void> {
  if (!isUnmergedCommitsRefusal(request.error)) {
    showBranchDeletionError(deps, request.error);
    return;
  }

  let keptTip: string;
  try {
    keptTip = await deps.git.readBranchTip(request.repositoryPath, request.branchName);
  } catch (error) {
    showBranchDeletionError(deps, error);
    return;
  }

  void offerGuardedForceDelete(request, keptTip, deps);
}

async function offerGuardedForceDelete(
  request: BranchDeletionRefusal,
  keptTip: string,
  deps: KeptBranchDeps,
): Promise<void> {
  try {
    const picked = await deps.notifications.showWarningMessage(
      `Worktree removed — branch \`${request.branchName}\` kept: git could not confirm its commits are merged.`,
      FORCE_DELETE_BRANCH,
    );
    if (picked !== FORCE_DELETE_BRANCH) return;

    const currentTip = await deps.git.readBranchTip(request.repositoryPath, request.branchName);
    if (currentTip !== keptTip) {
      deps.notifications.showWarningMessage(
        `Branch \`${request.branchName}\` has new commits since Deck kept it — review it before deleting.`,
      );
      return;
    }

    await deps.git.deleteBranch(request.repositoryPath, request.branchName, { force: true });
  } catch (error) {
    showBranchDeletionError(deps, error);
  }
}

function showBranchDeletionError(deps: KeptBranchDeps, error: unknown): void {
  deps.notifications.showErrorMessage(`Cannot delete branch: ${errorMessage(error)}`);
}

function isUnmergedCommitsRefusal(error: unknown): boolean {
  return errorMessage(error).includes('not fully merged');
}

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'stderr' in error) {
    const stderrValue = error.stderr;
    const stderr = typeof stderrValue === 'string' ? stderrValue.trim() : '';
    if (stderr) return stderr;
  }
  if (error instanceof Error) return error.message;
  return String(error);
}
