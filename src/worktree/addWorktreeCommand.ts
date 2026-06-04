import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  addWorktree,
  getCommonDir,
  listBranches,
  type AddWorktreeOptions,
} from '../git/worktrees';
import { branchWorktreeName, defaultWorktreePath } from './defaultWorktreePath';

const CREATE_BRANCH_LABEL = 'Create new branch...';

interface ProjectNodeLike {
  projectPath: string;
}

interface SwitcherLike {
  switchTo(targetPath: string): Promise<void>;
}

interface WorktreeRootStoreLike {
  get(commonDir: string): string | undefined;
  set(commonDir: string, rootPath: string): Promise<void>;
}

interface WorktreeRequest {
  path: string;
  add: AddWorktreeOptions;
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
  constructor(
    private readonly switcher: SwitcherLike,
    private readonly worktreeRoots: WorktreeRootStoreLike = {
      get: () => undefined,
      set: async () => undefined,
    },
  ) {}

  async run(node: ProjectNodeLike | undefined): Promise<void> {
    if (!node) return;

    const branches = await listBranches(node.projectPath);
    const picked = await vscode.window.showQuickPick(this.branchPicks(branches), {
      placeHolder: 'Select branch',
    });
    if (!picked) return;

    const commonDir = await getCommonDir(node.projectPath);
    const rememberedRoot = this.worktreeRoots.get(commonDir);
    let request: WorktreeRequest | undefined;
    if (picked.action === 'create') {
      request = await this.newBranchRequest(node.projectPath, rememberedRoot, branches);
    } else {
      request = await this.existingBranchRequest(node.projectPath, rememberedRoot, picked.branch);
    }
    if (!request) return;

    try {
      await addWorktree(node.projectPath, request.add);
    } catch (error) {
      vscode.window.showErrorMessage(`Cannot create worktree: ${errorMessage(error)}`);
      return;
    }

    await this.worktreeRoots.set(commonDir, path.dirname(request.path));
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

  private async existingBranchRequest(
    projectPath: string,
    rememberedRoot: string | undefined,
    branch: string,
  ): Promise<WorktreeRequest | undefined> {
    const targetPath = await this.promptForPath(projectPath, branch, rememberedRoot);
    if (!targetPath) return undefined;
    return {
      path: targetPath,
      add: {
        path: targetPath,
        branch,
      },
    };
  }

  private async newBranchRequest(
    projectPath: string,
    rememberedRoot: string | undefined,
    branches: string[],
  ): Promise<WorktreeRequest | undefined> {
    const newBranch = (await vscode.window.showInputBox({ prompt: 'New branch name' }))?.trim();
    if (!newBranch) return undefined;

    const baseRef = (
      await vscode.window.showInputBox({
        prompt: 'Base ref',
        value: defaultBaseRef(branches),
      })
    )?.trim();
    if (!baseRef) return undefined;

    const targetPath = await this.promptForPath(projectPath, newBranch, rememberedRoot);
    if (!targetPath) return undefined;

    return {
      path: targetPath,
      add: {
        path: targetPath,
        newBranch,
        baseRef,
      },
    };
  }

  private async promptForPath(
    projectPath: string,
    branch: string,
    rememberedRoot: string | undefined,
  ): Promise<string | undefined> {
    const input = vscode.window.createInputBox();
    const worktreeName = branchWorktreeName(branch);
    const rootPickerButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('folder'),
      tooltip: 'Choose worktree root',
      location: vscode.QuickInputButtonLocation.Inline,
    };

    input.prompt = 'Worktree path';
    input.value = defaultWorktreePath(projectPath, branch, rememberedRoot);
    input.buttons = [rootPickerButton];

    return new Promise((resolve) => {
      let settled = false;
      const disposables: vscode.Disposable[] = [];
      const settle = (value: string | undefined) => {
        if (settled) return;
        settled = true;
        for (const disposable of disposables) disposable.dispose();
        input.dispose();
        resolve(value);
      };

      disposables.push(
        input.onDidAccept(() => {
          const targetPath = input.value.trim();
          settle(targetPath || undefined);
          input.hide();
        }),
        input.onDidHide(() => {
          settle(undefined);
        }),
        input.onDidTriggerButton(async (button) => {
          if (button !== rootPickerButton) return;
          const picked = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            defaultUri: vscode.Uri.file(
              rememberedRoot ?? path.dirname(path.normalize(projectPath)),
            ),
          });
          if (!picked || picked.length === 0) return;
          input.value = path.join(picked[0].fsPath, worktreeName);
        }),
      );

      input.show();
    });
  }
}

function defaultBaseRef(branches: string[]): string {
  for (const name of ['main', 'master']) {
    const local = branches.find((branch) => branch === name);
    if (local) return local;

    const remote = branches.find((branch) => branch.endsWith(`/${name}`));
    if (remote) return remote;
  }

  return branches[0] ?? 'HEAD';
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
