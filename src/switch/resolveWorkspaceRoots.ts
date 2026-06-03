import { getCommonDirSafe } from '../git/worktrees';
import { WorkspaceRoot } from './workspaceRootPlanner';

export interface FolderRef {
  path: string;
  name?: string;
}

export async function resolveWorkspaceRoots(
  folders: readonly FolderRef[],
): Promise<WorkspaceRoot[]> {
  return Promise.all(
    folders.map(async (folder) => ({
      path: folder.path,
      name: folder.name,
      commonDir: await getCommonDirSafe(folder.path),
    })),
  );
}
