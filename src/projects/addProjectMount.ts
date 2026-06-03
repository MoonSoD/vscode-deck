import { WorkspaceRoot, WorkspaceRootPlanner } from '../switch/workspaceRootPlanner';

type MaybePromise<T> = T | PromiseLike<T>;

export interface AddProjectMountDeps {
  listProjects(): readonly string[];
  updateProjects(projectPaths: readonly string[]): MaybePromise<void>;
  getCommonDir(worktreePath: string): MaybePromise<string>;
  getCurrentRoots(): MaybePromise<WorkspaceRoot[]>;
  appendWorkspaceRoots(roots: WorkspaceRoot[]): MaybePromise<void>;
  setActiveWorktree(commonDir: string, worktreePath: string): MaybePromise<void>;
}

export async function addProjectMount(
  seedPath: string,
  deps: AddProjectMountDeps,
): Promise<void> {
  const commonDir = await deps.getCommonDir(seedPath);
  const projects = deps.listProjects();
  const registeredCommonDirs = await Promise.all(
    projects.map((projectPath) => deps.getCommonDir(projectPath)),
  );
  if (registeredCommonDirs.includes(commonDir)) return;

  await deps.updateProjects([...projects, seedPath]);
  await deps.setActiveWorktree(commonDir, seedPath);

  const currentRoots = await deps.getCurrentRoots();
  const plannedRoots = WorkspaceRootPlanner.planReconcile(currentRoots, [{ path: seedPath, commonDir }]);
  const rootsToAppend = plannedRoots.slice(currentRoots.length);
  if (rootsToAppend.length === 0) return;

  await deps.appendWorkspaceRoots(rootsToAppend);
}
