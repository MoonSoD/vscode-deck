export interface WorkspaceRoot {
  path: string;
  commonDir: string;
  name?: string;
}

export class WorkspaceRootPlanner {
  static planSwap(current: WorkspaceRoot[], target: WorkspaceRoot): WorkspaceRoot[] {
    const index = current.findIndex((root) => root.commonDir === target.commonDir);
    if (index === -1) return current;
    if (current[index].path === target.path) return current;

    const next = [...current];
    next[index] = target;
    return next;
  }
}
