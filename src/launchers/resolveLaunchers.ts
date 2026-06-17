import { readRepoLaunchers } from './repoLaunchers';
import {
  parseRepositoryLaunchers,
  selectRepositoryLaunchersFor,
} from './repositoryLaunchers';
import { parseTerminalLaunchers, type TerminalLauncher } from './terminalLaunchers';
import {
  PASS_THROUGH_COMMON_DIR_CACHE,
  resolveCommonDirSafe,
} from '../repository/repositoryCommonDirCache';

export interface LauncherGroups {
  repo: TerminalLauncher[];
  repositoryLocal: TerminalLauncher[];
  user: TerminalLauncher[];
}

interface ResolveLaunchersOptions {
  readRepo?: (worktreePath: string) => Promise<TerminalLauncher[]>;
  resolveCommonDir?: (repositoryPath: string) => Promise<string | null>;
}

export async function resolveLaunchers(
  worktreePath: string,
  userLauncherConfig: unknown,
  repositoryLauncherConfig: unknown = [],
  options: ResolveLaunchersOptions = {},
): Promise<LauncherGroups> {
  const readRepo = options.readRepo ?? readRepoLaunchers;
  const resolveCommonDir = options.resolveCommonDir ?? defaultResolveCommonDir;
  const repositoryLaunchers = parseRepositoryLaunchers(repositoryLauncherConfig);

  return {
    repo: await readRepo(worktreePath),
    repositoryLocal: await selectRepositoryLaunchersFor(
      worktreePath,
      repositoryLaunchers,
      resolveCommonDir,
    ),
    user: parseTerminalLaunchers(userLauncherConfig),
  };
}

export function hasLaunchers(groups: LauncherGroups): boolean {
  return groups.repo.length > 0 || groups.repositoryLocal.length > 0 || groups.user.length > 0;
}

export function selectRunOnWorktreeCreateLaunchers(groups: LauncherGroups): TerminalLauncher[] {
  return [
    ...groups.repo,
    ...groups.repositoryLocal,
    ...groups.user,
  ].filter((launcher) => launcher.runOnWorktreeCreate === true);
}

async function defaultResolveCommonDir(repositoryPath: string): Promise<string | null> {
  return resolveCommonDirSafe(PASS_THROUGH_COMMON_DIR_CACHE, repositoryPath);
}
