import * as vscode from 'vscode';
import {
  resolveLaunchers as resolveLauncherGroups,
  selectRunOnWorktreeCreateLaunchers,
  type LauncherGroups,
} from '../launchers/resolveLaunchers';
import {
  createHeadlessTerminal,
  type AddTerminalTmuxCli,
  type ResolvePreviewEnv,
  type WorktreeNodeLike,
} from './addTerminalCommand';

interface WorktreeCreateLauncherTmuxCli extends AddTerminalTmuxCli {
  sendCommandLine(session: string, command: string): Promise<void>;
}

interface WorktreeCreateLauncherRunnerOptions {
  refresh?: () => void;
  resolveLaunchers?: (
    worktreePath: string,
    userLauncherConfig: unknown,
    repositoryLauncherConfig: unknown,
  ) => Promise<LauncherGroups>;
  resolveCommonDir?: (repositoryPath: string) => Promise<string | null>;
  beforeCreate?: () => Promise<void>;
  resolvePreviewEnv?: ResolvePreviewEnv;
}

export class WorktreeCreateLauncherRunner {
  private readonly refresh: () => void;
  private readonly resolveLaunchers: (
    worktreePath: string,
    userLauncherConfig: unknown,
    repositoryLauncherConfig: unknown,
  ) => Promise<LauncherGroups>;
  private readonly beforeCreate: () => Promise<void>;
  private readonly resolvePreviewEnv: ResolvePreviewEnv;

  constructor(
    private readonly tmux: WorktreeCreateLauncherTmuxCli,
    options: WorktreeCreateLauncherRunnerOptions = {},
  ) {
    this.refresh = options.refresh ?? (() => undefined);
    this.resolveLaunchers = options.resolveLaunchers ?? ((worktreePath, userLaunchers, repositoryLaunchers) =>
      resolveLauncherGroups(worktreePath, userLaunchers, repositoryLaunchers, {
        resolveCommonDir: options.resolveCommonDir,
      }));
    this.beforeCreate = options.beforeCreate ?? (() => Promise.resolve());
    this.resolvePreviewEnv = options.resolvePreviewEnv ?? (async () => ({}));
  }

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    const userLaunchers = vscode.workspace.getConfiguration('deck').get('terminalLaunchers', []);
    const repositoryLaunchers = vscode.workspace.getConfiguration('deck').get('repositoryLaunchers', []);
    const groups = await this.resolveLaunchers(node.worktree.path, userLaunchers, repositoryLaunchers);
    const launchers = selectRunOnWorktreeCreateLaunchers(groups);
    if (launchers.length === 0) return;

    await this.beforeCreate();
    const env = await this.resolvePreviewEnv(node.worktree.path);
    for (const launcher of launchers) {
      const { session } = await createHeadlessTerminal(this.tmux, node, env);
      await this.tmux.sendCommandLine(session, launcher.command);
    }
    this.refresh();
  }
}
