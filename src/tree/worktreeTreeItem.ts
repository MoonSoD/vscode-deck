import { Worktree } from '../git/worktrees';
import type { AgentStatus } from '../agent/agentStatusStore';
import { resolveAgentIcon } from '../agent/agentIconResolver';

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
  tooltip?: string;
  iconId: 'terminal' | 'agent-working' | 'agent';
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
  // Agent identity comes from the window name — the hook renames the tmux
  // window to the agent name on SessionStart (incl. `claude --resume`), before
  // any status file exists. Key the icon off identity so a resumed/idle agent
  // still shows its mark; status only adds the working spinner.
  const resolvedIcon = resolveAgentIcon({ windowName, status, resourcesDir: '' });
  if (resolvedIcon.isAgent && resolvedIcon.state === 'working') {
    return {
      label: windowName,
      iconId: 'agent-working',
      contextValue,
    };
  }
  if (resolvedIcon.isAgent) {
    return {
      label: windowName,
      iconId: 'agent',
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
