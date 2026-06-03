export interface WorkspaceRoot {
  path: string;
  /** Git common dir, or null for a non-git workspace folder (preserved, never swapped). */
  commonDir: string | null;
  name?: string;
}

export class WorkspaceRootPlanner {
  static planSwap(current: WorkspaceRoot[], target: WorkspaceRoot): WorkspaceRoot[] {
    if (target.commonDir === null) return current;
    const index = current.findIndex((root) => root.commonDir === target.commonDir);
    if (index === -1) return current;
    if (current[index].path === target.path) return current;

    const next = [...current];
    next[index] = target;
    return next;
  }

  static planReconcile(current: WorkspaceRoot[], registry: WorkspaceRoot[]): WorkspaceRoot[] {
    const mountedCommonDirs = new Set(current.map((root) => root.commonDir));
    const missing = registry.filter((root) => {
      if (mountedCommonDirs.has(root.commonDir)) return false;
      mountedCommonDirs.add(root.commonDir);
      return true;
    });

    if (missing.length === 0) return current;
    return [...current, ...missing];
  }
}
