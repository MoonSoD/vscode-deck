import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  CommonDirCacheLike,
  PASS_THROUGH_COMMON_DIR_CACHE,
  resolveCommonDirSafe,
} from './repositoryCommonDirCache';

const SWITCH_LABEL = 'Switch';
const OPEN_IN_NEW_WINDOW_LABEL = 'Open in New Window';

export interface RepositoryFolderPicker {
  pick(): Promise<string | undefined>;
}

interface RepositoryRegistryLike {
  list(): readonly string[];
  append(repositoryPath: string): Promise<void>;
}

interface ActiveWorktreeStoreLike {
  set(commonDir: string, worktreePath: string): Promise<void>;
}

interface SwitcherLike {
  switchTo(targetPath: string): Promise<void>;
}

interface DetachedOpenerLike {
  open(targetPath: string): Promise<void>;
}

export class VsCodeRepositoryFolderPicker implements RepositoryFolderPicker {
  async pick(): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Add as Deck repository',
    });
    return picked?.[0]?.fsPath;
  }
}

export class AddRepositoryCommand {
  constructor(
    private readonly picker: RepositoryFolderPicker,
    private readonly registry: RepositoryRegistryLike,
    private readonly activeWorktrees: ActiveWorktreeStoreLike,
    private readonly switcher: SwitcherLike,
    private readonly detachedOpener: DetachedOpenerLike,
    private readonly refresh: () => void,
    private readonly reveal: (repositoryPath: string) => Promise<void>,
    private readonly repositoryCommonDirCache: CommonDirCacheLike = PASS_THROUGH_COMMON_DIR_CACHE,
  ) {}

  async run(): Promise<void> {
    const seedPath = await this.picker.pick();
    if (!seedPath) return;

    const commonDir = await resolveCommonDirSafe(this.repositoryCommonDirCache, seedPath);
    if (commonDir === null) {
      vscode.window.showErrorMessage(`Cannot add ${seedPath}: not a git repository.`);
      return;
    }

    const isRegistered = await this.hasRegisteredCommonDir(commonDir);
    if (!isRegistered) await this.registry.append(seedPath);

    await this.activeWorktrees.set(commonDir, seedPath);
    this.refresh();
    await this.reveal(seedPath);

    const postAddAction = await vscode.window.showInformationMessage(
      `Added repository ${path.basename(seedPath)}.`,
      SWITCH_LABEL,
      OPEN_IN_NEW_WINDOW_LABEL,
    );
    if (postAddAction === SWITCH_LABEL) {
      await this.switcher.switchTo(seedPath);
    } else if (postAddAction === OPEN_IN_NEW_WINDOW_LABEL) {
      await this.detachedOpener.open(seedPath);
    }
  }

  private async hasRegisteredCommonDir(commonDir: string): Promise<boolean> {
    for (const repositoryPath of this.registry.list()) {
      const registered = await resolveCommonDirSafe(this.repositoryCommonDirCache, repositoryPath);
      if (registered !== null && registered === commonDir) return true;
    }
    return false;
  }
}
