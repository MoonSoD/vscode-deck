import * as vscode from 'vscode';
import {
  CommonDirCacheLike,
  PASS_THROUGH_COMMON_DIR_CACHE,
  resolveCommonDir,
} from '../project/projectCommonDirCache';
import {
  deleteBranch,
  getWorktreeStatus,
  removeWorktree,
  Worktree,
} from '../git/worktrees';
import { canRemoveWorktree } from './worktreeRemoval';

interface WorktreeNodeLike {
  projectPath: string;
  mainWorktreePath?: string;
  worktree: Worktree;
}

interface ActiveWorktreeStoreLike {
  get(commonDir: string): string | undefined;
  clear(commonDir: string): Promise<void>;
}

interface BranchDeletionPreferenceStoreLike {
  get(): boolean;
  set(value: boolean): Promise<void>;
}

interface WorktreeListCacheLike {
  remove(commonDir: string, worktreePath: string): Promise<void>;
}

const REMOVE_LABEL = 'Remove';
const FORCE_REMOVE_LABEL = 'Force Remove';

interface RemovalActions {
  labels: string[];
  keepBranchLabel?: string;
  deleteBranchLabel?: string;
}

export class WorktreeRemovalCommand {
  constructor(
    private readonly activeWorktrees: ActiveWorktreeStoreLike,
    private readonly refresh: () => void,
    private readonly branchDeletionPreferences: BranchDeletionPreferenceStoreLike = {
      get: () => false,
      set: async () => undefined,
    },
    private readonly worktreeListCache: WorktreeListCacheLike = {
      remove: async () => undefined,
    },
    private readonly projectCommonDirCache: CommonDirCacheLike = PASS_THROUGH_COMMON_DIR_CACHE,
  ) {}

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    const activeWorktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const decision = canRemoveWorktree(
      node.worktree,
      activeWorktreePath,
      node.mainWorktreePath,
    );
    if (!decision.canDelete) {
      // VS Code's modal provides an implicit Cancel button; no explicit action items.
      await vscode.window.showWarningMessage(
        `Remove worktree at \`${node.worktree.path}\`?`,
        { modal: true, detail: decision.reason },
      );
      return;
    }

    let status: { hasChanges: boolean; hasUnpushedCommits: boolean };
    try {
      status = await getWorktreeStatus(node.worktree.path);
    } catch (error) {
      vscode.window.showErrorMessage(`Cannot inspect worktree: ${errorMessage(error)}`);
      return;
    }
    const force = status.hasChanges || node.worktree.locked === true;
    const actionLabel = force ? FORCE_REMOVE_LABEL : REMOVE_LABEL;
    const branchName = node.worktree.detached ? undefined : node.worktree.branch;
    const actions = removalActions(
      actionLabel,
      branchName,
      this.branchDeletionPreferences.get(),
    );
    const picked = await vscode.window.showWarningMessage(
      `Remove worktree at \`${node.worktree.path}\`?`,
      { modal: true, detail: warningDetail(status, node.worktree.locked === true) },
      ...actions.labels,
    );
    // VS Code's modal adds its own Cancel; undefined here = user cancelled.
    if (!picked) return;

    const deleteLocalBranch = branchDeletionChoice(actions, picked);
    if (deleteLocalBranch === undefined) return;

    if (branchName) {
      await this.branchDeletionPreferences.set(deleteLocalBranch);
    }

    let commonDir: string;
    try {
      commonDir = await resolveCommonDir(this.projectCommonDirCache, node.projectPath);
      await removeWorktree(node.projectPath, node.worktree.path, { force });
    } catch (error) {
      vscode.window.showErrorMessage(`Cannot remove worktree: ${errorMessage(error)}`);
      return;
    }

    if (deleteLocalBranch && branchName) {
      try {
        await deleteBranch(node.projectPath, branchName);
      } catch (error) {
        vscode.window.showErrorMessage(`Cannot delete branch: ${errorMessage(error)}`);
      }
    }

    if (this.activeWorktrees.get(commonDir) === node.worktree.path) {
      await this.activeWorktrees.clear(commonDir);
    }
    await this.worktreeListCache.remove(commonDir, node.worktree.path);
    this.refresh();
  }
}

function removalActions(
  actionLabel: string,
  branchName: string | undefined,
  deleteBranchByDefault: boolean,
): RemovalActions {
  // No explicit Cancel — VS Code's modal supplies its own Cancel/Esc affordance.
  if (!branchName) return { labels: [actionLabel] };

  const keepBranchLabel = `${actionLabel} (keep branch)`;
  const deleteBranchLabel = `${actionLabel} and delete branch`;
  const orderedActions = deleteBranchByDefault
    ? [deleteBranchLabel, keepBranchLabel]
    : [keepBranchLabel, deleteBranchLabel];
  return {
    labels: orderedActions,
    keepBranchLabel,
    deleteBranchLabel,
  };
}

function branchDeletionChoice(
  actions: RemovalActions,
  picked: string,
): boolean | undefined {
  if (!actions.deleteBranchLabel) return false;
  if (picked === actions.deleteBranchLabel) return true;
  if (picked === actions.keepBranchLabel) return false;
  return undefined;
}

function warningDetail(
  status: { hasChanges: boolean; hasUnpushedCommits: boolean },
  locked: boolean,
): string | undefined {
  const warnings: string[] = [];
  if (status.hasChanges) warnings.push('uncommitted changes');
  if (status.hasUnpushedCommits) warnings.push('unpushed commits');
  if (locked) warnings.push('locked worktree');
  if (warnings.length === 0) return undefined;
  return `Warning: this worktree has ${warnings.join(', ')}.`;
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
