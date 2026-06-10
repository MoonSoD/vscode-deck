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
  iconId: 'terminal' | 'loading~spin' | 'circle-filled' | 'circle-small-filled' | 'error';
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
  needsInputCount = 0,
): RepositoryTreeItemDescription {
  return {
    label: repositoryPath.split('/').pop() ?? repositoryPath,
    description: withNeedsInputCount(isActiveRepository ? 'active' : '', needsInputCount),
    iconId: 'folder',
  };
}

export function describeWorktreeTreeItem(
  worktree: Worktree,
  activeWorktreePath: string | undefined,
  mainWorktreePath?: string,
  needsInputCount = 0,
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
    description: withNeedsInputCount(worktree.path, needsInputCount),
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
    if (status.unread === false) {
      return {
        label: windowName,
        iconId: 'circle-small-filled',
        contextValue,
      };
    }
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

function withNeedsInputCount(description: string, count: number): string {
  if (count <= 0) return description;
  const suffix = `· ${count} needs input`;
  return description ? `${description} ${suffix}` : suffix;
}
