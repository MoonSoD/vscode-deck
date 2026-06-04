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
  contextValue: 'deck.worktree.active' | 'deck.worktree.main' | 'deck.worktree';
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
  mainWorktreePath?: string,
): WorktreeTreeItemDescription {
  const isActive = worktree.path === activeWorktreePath;
  const isMain = worktree.path === mainWorktreePath;
  return {
    label: worktree.branch ?? worktree.path,
    description: worktree.path,
    iconId: isActive ? 'check' : 'git-branch',
    contextValue: isActive ? 'deck.worktree.active' : isMain ? 'deck.worktree.main' : 'deck.worktree',
  };
}
