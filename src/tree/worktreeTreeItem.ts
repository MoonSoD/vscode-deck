import { Worktree } from '../git/worktrees';

export interface ProjectTreeItemDescription {
  label: string;
  description: string;
  iconId: 'repo';
}

export interface WorktreeTreeItemDescription {
  label: string;
  description: string;
  iconId: 'check' | 'git-branch';
  contextValue: 'worktree.active' | 'worktree';
}

export function describeProjectTreeItem(
  projectPath: string,
  isActiveProject: boolean,
): ProjectTreeItemDescription {
  return {
    label: projectPath.split('/').pop() ?? projectPath,
    description: isActiveProject ? 'active' : '',
    iconId: 'repo',
  };
}

export function describeWorktreeTreeItem(
  worktree: Worktree,
  activeWorktreePath: string | undefined,
): WorktreeTreeItemDescription {
  const isActive = worktree.path === activeWorktreePath;
  return {
    label: worktree.branch ?? worktree.path,
    description: worktree.path,
    iconId: isActive ? 'check' : 'git-branch',
    contextValue: isActive ? 'worktree.active' : 'worktree',
  };
}
