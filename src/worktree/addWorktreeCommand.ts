import * as vscode from 'vscode';
import { addWorktree, listBranches } from '../git/worktrees';
import { WorktreeSwitcher } from '../switch/worktreeSwitcher';
import { defaultWorktreePath } from './defaultWorktreePath';

const CREATE_BRANCH_LABEL = 'Create new branch...';

interface ProjectNodeLike {
  projectPath: string;
}

interface SwitcherLike {
  switchTo(targetPath: string): Promise<void>;
}

type BranchPick = vscode.QuickPickItem &
  (
    | {
        action: 'create';
      }
    | {
        action: 'existing';
        branch: string;
      }
  );

export class AddWorktreeCommand {
  constructor(private readonly switcher: WorktreeSwitcher | SwitcherLike) {}

  async run(node: ProjectNodeLike | undefined): Promise<void> {
    if (!node) return;

    const branches = await listBranches(node.projectPath);
    const picked = await vscode.window.showQuickPick(this.branchPicks(branches), {
      placeHolder: 'Select branch',
    });
    if (!picked) return;

    const request =
      picked.action === 'create'
        ? await this.newBranchRequest(node.projectPath, branches)
        : await this.existingBranchRequest(node.projectPath, picked.branch);
    if (!request) return;

    try {
      await addWorktree(node.projectPath, request.add);
    } catch (error) {
      vscode.window.showErrorMessage(`Cannot create worktree: ${errorMessage(error)}`);
      return;
    }

    await this.switcher.switchTo(request.path);
  }

  private branchPicks(branches: string[]): BranchPick[] {
    return [
      {
        label: CREATE_BRANCH_LABEL,
        action: 'create',
      },
      ...branches.map(
        (branch): BranchPick => ({
          label: branch,
          action: 'existing',
          branch,
        }),
      ),
    ];
  }

  private async existingBranchRequest(projectPath: string, branch: string) {
    const path = await this.promptForPath(projectPath, branch);
    if (!path) return undefined;
    return {
      path,
      add: {
        path,
        branch,
      },
    };
  }

  private async newBranchRequest(projectPath: string, branches: string[]) {
    const newBranch = (await vscode.window.showInputBox({ prompt: 'New branch name' }))?.trim();
    if (!newBranch) return undefined;

    const baseRef = (
      await vscode.window.showInputBox({
        prompt: 'Base ref',
        value: defaultBaseRef(branches),
      })
    )?.trim();
    if (!baseRef) return undefined;

    const path = await this.promptForPath(projectPath, newBranch);
    if (!path) return undefined;

    return {
      path,
      add: {
        path,
        newBranch,
        baseRef,
      },
    };
  }

  private async promptForPath(projectPath: string, branch: string): Promise<string | undefined> {
    const targetPath = (
      await vscode.window.showInputBox({
        prompt: 'Worktree path',
        value: defaultWorktreePath(projectPath, branch),
      })
    )?.trim();
    return targetPath || undefined;
  }
}

function defaultBaseRef(branches: string[]): string {
  return (
    branches.find((branch) => branch === 'main') ??
    branches.find((branch) => branch.endsWith('/main')) ??
    branches.find((branch) => branch === 'master') ??
    branches.find((branch) => branch.endsWith('/master')) ??
    branches[0] ??
    'HEAD'
  );
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
