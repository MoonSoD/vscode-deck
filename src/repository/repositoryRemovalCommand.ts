import * as vscode from 'vscode';
import { getCommonDirSafe, listWorktrees } from '../git/worktrees';

interface RepositoryNodeLike {
  repositoryPath: string;
}

interface PerRepositoryStoreLike {
  clear(commonDir: string): Promise<void>;
}

interface RepositoryRegistryLike {
  remove(repositoryPath: string): Promise<void>;
}

interface TerminalCascadeLike {
  killWorktree(worktreePath: string): Promise<void>;
}

interface PreviewCascadeLike {
  closeWorktree(worktreePath: string): Promise<void>;
}

interface WorktreeListCacheLike {
  get(commonDir: string): ReadonlyArray<{ path: string }> | undefined;
}

const REMOVE_LABEL = 'Remove from Deck';
const BASE_DETAIL = 'This only removes the Repository from Deck. Files and git history are untouched.';
const ACTIVE_REPOSITORY_DETAIL =
  "You're currently in this Repository's worktree. The folder will stay open, but Deck will no longer show this Repository.";

export class RepositoryRemovalCommand {
  constructor(
    private readonly repositoryRegistry: RepositoryRegistryLike,
    private readonly activeWorktrees: PerRepositoryStoreLike,
    private readonly worktreeRoots: PerRepositoryStoreLike,
    private readonly worktreeOrders: PerRepositoryStoreLike,
    private readonly refresh: () => void,
    private readonly terminalCascade: TerminalCascadeLike = {
      killWorktree: async () => undefined,
    },
    private readonly worktreeListCache: WorktreeListCacheLike | undefined = undefined,
    private readonly previewCascade: PreviewCascadeLike = {
      closeWorktree: async () => undefined,
    },
  ) {}

  async run(node: RepositoryNodeLike | undefined): Promise<void> {
    if (!node) return;

    const commonDir = await getCommonDirSafe(node.repositoryPath);
    const activeFolderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const activeCommonDir = activeFolderPath
      ? await getCommonDirSafe(activeFolderPath)
      : null;
    const detail =
      commonDir !== null && commonDir === activeCommonDir
        ? `${BASE_DETAIL}\n\n${ACTIVE_REPOSITORY_DETAIL}`
        : BASE_DETAIL;

    // VS Code's modal supplies its own Cancel — don't add an explicit one.
    const picked = await vscode.window.showInformationMessage(
      `Remove \`${node.repositoryPath}\` from Deck?`,
      { modal: true, detail },
      REMOVE_LABEL,
    );
    if (picked !== REMOVE_LABEL) return;

    await this.killRepositoryTerminals(node.repositoryPath, commonDir);
    await this.repositoryRegistry.remove(node.repositoryPath);

    if (commonDir !== null) {
      await this.activeWorktrees.clear(commonDir);
      await this.worktreeRoots.clear(commonDir);
      await this.worktreeOrders.clear(commonDir);
    }
    this.refresh();
  }

  private async killRepositoryTerminals(
    repositoryPath: string,
    commonDir: string | null,
  ): Promise<void> {
    // Fall back to the cached worktree list when `git worktree list` fails
    // (corrupt git dir, dangling worktree refs). Cache is hydrated sync from
    // globalState on activation, so previous successful enumerations survive.
    let worktreePaths: readonly string[];
    try {
      const worktrees = await listWorktrees(repositoryPath);
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
        // Tmux cleanup must not block RepositoryRemoval.
      }
      try {
        await this.previewCascade.closeWorktree(worktreePath);
      } catch {
        // Chrome cleanup must not block RepositoryRemoval.
      }
    }
  }
}
