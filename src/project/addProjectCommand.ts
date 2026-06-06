import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  CommonDirCacheLike,
  PASS_THROUGH_COMMON_DIR_CACHE,
  resolveCommonDirSafe,
} from './projectCommonDirCache';

const SWITCH_LABEL = 'Switch';
const OPEN_IN_NEW_WINDOW_LABEL = 'Open in New Window';

export interface ProjectFolderPicker {
  pick(): Promise<string | undefined>;
}

interface ProjectRegistryLike {
  list(): readonly string[];
  append(projectPath: string): Promise<void>;
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

export class VsCodeProjectFolderPicker implements ProjectFolderPicker {
  async pick(): Promise<string | undefined> {
    const picked = await vscode.window.showOpenDialog({
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      openLabel: 'Add as Deck project',
    });
    return picked?.[0]?.fsPath;
  }
}

export class AddProjectCommand {
  constructor(
    private readonly picker: ProjectFolderPicker,
    private readonly registry: ProjectRegistryLike,
    private readonly activeWorktrees: ActiveWorktreeStoreLike,
    private readonly switcher: SwitcherLike,
    private readonly detachedOpener: DetachedOpenerLike,
    private readonly refresh: () => void,
    private readonly reveal: (projectPath: string) => Promise<void>,
    private readonly projectCommonDirCache: CommonDirCacheLike = PASS_THROUGH_COMMON_DIR_CACHE,
  ) {}

  async run(): Promise<void> {
    const seedPath = await this.picker.pick();
    if (!seedPath) return;

    const commonDir = await resolveCommonDirSafe(this.projectCommonDirCache, seedPath);
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
      `Added project ${path.basename(seedPath)}.`,
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
    for (const projectPath of this.registry.list()) {
      const registered = await resolveCommonDirSafe(this.projectCommonDirCache, projectPath);
      if (registered !== null && registered === commonDir) return true;
    }
    return false;
  }
}
