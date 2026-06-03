export interface WorkspaceRoot {
  path: string;
  /** Git common dir, or null for a non-git workspace folder (preserved, never swapped). */
  commonDir: string | null;
  name?: string;
}

export interface RecoverableWorkspaceRoot extends WorkspaceRoot {
  exists: boolean;
}

export interface RecoveryProject {
  commonDir: string;
  activePath?: string;
  mainRoot?: WorkspaceRoot;
}

export interface RecoveredRoot {
  index: number;
  missingPath: string;
  recoveryPath: string;
  commonDir: string;
}

export interface UnrecoverableRoot {
  missingPath: string;
  commonDir: string;
}

export interface RecoveryPlan {
  roots: WorkspaceRoot[];
  recovered: RecoveredRoot[];
  unrecoverable: UnrecoverableRoot[];
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

  static planRecovery(
    current: RecoverableWorkspaceRoot[],
    projects: RecoveryProject[],
  ): RecoveryPlan {
    const recovered: RecoveredRoot[] = [];
    const unrecoverable: UnrecoverableRoot[] = [];

    const roots = current.map((root, index) => {
      if (root.exists) {
        const { exists: _exists, ...workspaceRoot } = root;
        return workspaceRoot;
      }

      const project = projects.find(
        (candidate) =>
          candidate.commonDir === root.commonDir && candidate.activePath === root.path,
      );
      if (!project) {
        const { exists: _exists, ...workspaceRoot } = root;
        return workspaceRoot;
      }

      if (!project.mainRoot) {
        unrecoverable.push({ missingPath: root.path, commonDir: project.commonDir });
        const { exists: _exists, ...workspaceRoot } = root;
        return workspaceRoot;
      }

      recovered.push({
        index,
        missingPath: root.path,
        recoveryPath: project.mainRoot.path,
        commonDir: project.commonDir,
      });
      return project.mainRoot;
    });

    return { roots, recovered, unrecoverable };
  }
}
