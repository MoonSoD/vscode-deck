import { Worktree } from '../git/worktrees';

export interface RepositoryTreeItemDescription {
  label: string;
  description: string;
  iconId: 'folder';
}

export interface WorktreeTreeItemDescription {
  label: string;
  description: string;
  iconId: 'check' | 'git-branch';
  contextValue: 'deck.worktree.active' | 'deck.worktree.main' | 'deck.worktree';
}

export interface TerminalAddTreeItemDescription {
  label: 'Add Terminal';
  iconId: 'add';
  contextValue: 'deck.terminal.add';
}

export interface TerminalTreeItemDescription {
  label: string;
  iconId: 'terminal';
  contextValue: 'deck.terminal.active' | 'deck.terminal.foreign';
}

export interface TmuxUnavailableTreeItemDescription {
  label: 'tmux ≥3.1 not found · install ↗';
  iconId: 'warning';
  contextValue: 'deck.tmux.unavailable';
  tooltip: 'Install tmux 3.1 or newer to use Deck-managed Terminals.';
}

export function describeRepositoryTreeItem(
  repositoryPath: string,
  isActiveRepository: boolean,
): RepositoryTreeItemDescription {
  return {
    label: repositoryPath.split('/').pop() ?? repositoryPath,
    description: isActiveRepository ? 'active' : '',
    iconId: 'folder',
  };
}

export function describeWorktreeTreeItem(
  worktree: Worktree,
  activeWorktreePath: string | undefined,
  mainWorktreePath?: string,
): WorktreeTreeItemDescription {
  const isActive = worktree.path === activeWorktreePath;
  const isMain = worktree.path === mainWorktreePath;
  let contextValue: WorktreeTreeItemDescription['contextValue'] = 'deck.worktree';
  if (isActive) {
    contextValue = 'deck.worktree.active';
  } else if (isMain) {
    contextValue = 'deck.worktree.main';
  }

  return {
    label: worktree.branch ?? worktree.path,
    description: worktree.path,
    iconId: isActive ? 'check' : 'git-branch',
    contextValue,
  };
}

export function describeTerminalAddTreeItem(): TerminalAddTreeItemDescription {
  return {
    label: 'Add Terminal',
    iconId: 'add',
    contextValue: 'deck.terminal.add',
  };
}

export function describeTerminalTreeItem(
  windowName: string,
  isActive: boolean,
): TerminalTreeItemDescription {
  return {
    label: windowName,
    iconId: 'terminal',
    contextValue: isActive ? 'deck.terminal.active' : 'deck.terminal.foreign',
  };
}

export function describeTmuxUnavailableTreeItem(): TmuxUnavailableTreeItemDescription {
  return {
    label: 'tmux ≥3.1 not found · install ↗',
    iconId: 'warning',
    contextValue: 'deck.tmux.unavailable',
    tooltip: 'Install tmux 3.1 or newer to use Deck-managed Terminals.',
  };
}
