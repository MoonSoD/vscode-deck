import * as vscode from 'vscode';
import { getCommonDirSafe } from '../git/worktrees';

interface ProjectNodeLike {
  projectPath: string;
}

interface PerProjectStoreLike {
  clear(commonDir: string): Promise<void>;
}

interface ProjectRegistryLike {
  remove(projectPath: string): Promise<void>;
}

const REMOVE_LABEL = 'Remove from Deck';
const BASE_DETAIL = 'This only removes the Project from Deck. Files and git history are untouched.';
const ACTIVE_PROJECT_DETAIL =
  "You're currently in this Project's worktree. The folder will stay open, but Deck will no longer show this Project.";

export class ProjectRemovalCommand {
  constructor(
    private readonly projectRegistry: ProjectRegistryLike,
    private readonly activeWorktrees: PerProjectStoreLike,
    private readonly worktreeRoots: PerProjectStoreLike,
    private readonly worktreeOrders: PerProjectStoreLike,
    private readonly refresh: () => void,
  ) {}

  async run(node: ProjectNodeLike | undefined): Promise<void> {
    if (!node) return;

    const commonDir = await getCommonDirSafe(node.projectPath);
    const activeFolderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const activeCommonDir = activeFolderPath
      ? await getCommonDirSafe(activeFolderPath)
      : null;
    const detail =
      commonDir !== null && commonDir === activeCommonDir
        ? `${BASE_DETAIL}\n\n${ACTIVE_PROJECT_DETAIL}`
        : BASE_DETAIL;

    // VS Code's modal supplies its own Cancel — don't add an explicit one.
    const picked = await vscode.window.showInformationMessage(
      `Remove \`${node.projectPath}\` from Deck?`,
      { modal: true, detail },
      REMOVE_LABEL,
    );
    if (picked !== REMOVE_LABEL) return;

    await this.projectRegistry.remove(node.projectPath);

    if (commonDir !== null) {
      await this.activeWorktrees.clear(commonDir);
      await this.worktreeRoots.clear(commonDir);
      await this.worktreeOrders.clear(commonDir);
    }
    this.refresh();
  }
}
