import { getCommonDirSafe } from '../git/worktrees';
import { WorkspaceRoot } from './workspaceRootPlanner';

export interface FolderRef {
  path: string;
  name?: string;
}

/**
 * Resolve workspace folders into WorkspaceRoots, tolerating non-git folders:
 * each folder's git common dir is resolved safely (null when not a git
 * worktree). Folders are always preserved — a non-git folder keeps its slot
 * and is never matched for a swap.
 */
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
