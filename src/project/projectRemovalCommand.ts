import * as vscode from 'vscode';
import { getCommonDirSafe, listWorktrees } from '../git/worktrees';

interface ProjectNodeLike {
  projectPath: string;
}

interface PerProjectStoreLike {
  clear(commonDir: string): Promise<void>;
}

interface ProjectRegistryLike {
  remove(projectPath: string): Promise<void>;
}

interface TerminalCascadeLike {
  killWorktree(worktreePath: string): Promise<void>;
}

interface WorktreeListCacheLike {
  get(commonDir: string): ReadonlyArray<{ path: string }> | undefined;
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
    private readonly terminalCascade: TerminalCascadeLike = {
      killWorktree: async () => undefined,
    },
    private readonly worktreeListCache: WorktreeListCacheLike | undefined = undefined,
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

    await this.killProjectTerminals(node.projectPath, commonDir);
    await this.projectRegistry.remove(node.projectPath);

    if (commonDir !== null) {
      await this.activeWorktrees.clear(commonDir);
      await this.worktreeRoots.clear(commonDir);
      await this.worktreeOrders.clear(commonDir);
    }
    this.refresh();
  }

  private async killProjectTerminals(
    projectPath: string,
    commonDir: string | null,
  ): Promise<void> {
    // Fall back to the cached worktree list when `git worktree list` fails
    // (corrupt git dir, dangling worktree refs). Cache is hydrated sync from
    // globalState on activation, so previous successful enumerations survive.
    let worktreePaths: readonly string[];
    try {
      const worktrees = await listWorktrees(projectPath);
      worktreePaths = worktrees.map((w) => w.path);
    } catch {
      const cached = commonDir !== null ? this.worktreeListCache?.get(commonDir) : undefined;
      if (!cached || cached.length === 0) return;
      worktreePaths = cached.map((w) => w.path);
    }

    for (const worktreePath of worktreePaths) {
      try {
        await this.terminalCascade.killWorktree(worktreePath);
      } catch {
        // Tmux cleanup must not block ProjectRemoval.
      }
    }
  }
}
