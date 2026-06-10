import { Worktree } from '../git/worktrees';
import type { AgentStatus } from '../agent/agentStatusStore';

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

export interface TerminalTreeItemDescription {
  label: string;
  description?: string;
  iconId: 'terminal' | 'loading~spin' | 'circle-filled' | 'error';
  iconColorId?: 'textLink.foreground' | 'list.warningForeground' | 'errorForeground';
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

export function describeTerminalTreeItem(
  windowName: string,
  isActive: boolean,
  status?: AgentStatus,
): TerminalTreeItemDescription {
  const contextValue = isActive ? 'deck.terminal.active' : 'deck.terminal.foreign';
  if (status?.status === 'inProgress') {
    return {
      label: windowName,
      description: 'Working...',
      iconId: 'loading~spin',
      iconColorId: 'textLink.foreground',
      contextValue,
    };
  }
  if (status?.status === 'needsInput') {
    return {
      label: windowName,
      description: 'Input needed.',
      iconId: 'circle-filled',
      iconColorId: 'list.warningForeground',
      contextValue,
    };
  }
  if (status?.status === 'completed') {
    return {
      label: windowName,
      iconId: 'circle-filled',
      iconColorId: 'textLink.foreground',
      contextValue,
    };
  }
  if (status?.status === 'failed') {
    return {
      label: windowName,
      description: 'Failed',
      iconId: 'error',
      iconColorId: 'errorForeground',
      contextValue,
    };
  }

  return {
    label: windowName,
    iconId: 'terminal',
    contextValue,
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
