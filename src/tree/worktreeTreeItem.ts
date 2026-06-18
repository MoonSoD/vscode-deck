import { Worktree } from '../git/worktrees';
import type { AgentStatus } from '../agent/agentStatusStore';
import { resolveAgentIcon } from '../agent/agentIconResolver';
import { resolveTerminalLabel } from '../terminal/terminalLabelResolver';

export interface RepositoryTreeItemDescription {
  label: string;
  description: string;
}

export interface WorktreeTreeItemDescription {
  label: string;
  description: string;
  tooltip: string;
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
    // Active text is the non-color channel for colorblind users; do not remove.
    description: isActiveRepository ? 'active' : '',
  };
}

export function describeWorktreeTreeItem(
  worktree: Worktree,
  isActive: boolean,
  mainWorktreePath?: string,
): WorktreeTreeItemDescription {
  const isMain = worktree.path === mainWorktreePath;
  let contextValue: WorktreeTreeItemDescription['contextValue'] = 'deck.worktree';
  if (isActive) {
    contextValue = 'deck.worktree.active';
  } else if (isMain) {
    contextValue = 'deck.worktree.main';
  }

  return {
    label: worktree.branch ?? worktree.path,
    // Active text is the non-color channel for colorblind users; do not remove.
    description: isActive ? 'active' : '',
    tooltip: worktree.path,
    contextValue,
  };
}

export function describeTerminalTreeItem(
  windowName: string,
  isActive: boolean,
  status?: AgentStatus,
  paneTitle?: string,
): TerminalTreeItemDescription {
  const contextValue = isActive ? 'deck.terminal.active' : 'deck.terminal.foreign';
  const label = resolveTerminalLabel(windowName, paneTitle);
  // Agent identity comes from the window name — the hook renames the tmux
  // window to the agent name on SessionStart (incl. `claude --resume`), before
  // any status file exists. Key the icon off identity so a resumed/idle agent
  // still shows its mark; status only adds the working spinner.
  const resolvedIcon = resolveAgentIcon({ windowName, status, resourcesDir: '' });
  if (resolvedIcon.isAgent && resolvedIcon.state === 'working') {
    return {
      label,
      iconId: 'agent-working',
      contextValue,
    };
  }
  if (resolvedIcon.isAgent) {
    return {
      label,
      iconId: 'agent',
      contextValue,
    };
  }

  return {
    label,
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
