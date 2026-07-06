import * as path from 'node:path';
import { Worktree } from '../git/worktrees';
import type { AgentStatus } from '../agent/agentStatusStore';
import type { AgentName } from '../agent/agentTypes';
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
    label: worktree.branch ?? path.basename(worktree.path),
    // Active text is the non-color channel for colorblind users; do not remove.
    description: isActive ? 'active' : '',
    tooltip: worktree.detached ? detachedWorktreeTooltip(worktree) : worktree.path,
    contextValue,
  };
}

function detachedWorktreeTooltip(worktree: Worktree): string {
  const shortHead = worktree.head.slice(0, 7);
  if (shortHead.length === 0) return `${worktree.path}\nDetached HEAD`;
  return `${worktree.path}\nDetached HEAD · ${shortHead}`;
}

export function describeTerminalTreeItem(
  windowName: string,
  isActive: boolean,
  status?: AgentStatus,
  paneTitle?: string,
  agentName?: AgentName,
): TerminalTreeItemDescription {
  const contextValue = isActive ? 'deck.terminal.active' : 'deck.terminal.foreign';
  const identity = agentName ?? agentNameFromStatus(status);
  const label = resolveTerminalLabel(windowName, paneTitle, identity);
  // Resolve the icon from the same explicit identity as the label, so a
  // sidecar-only agent (idle, no status file yet) whose window name has gone
  // volatile still shows its mark instead of the plain terminal glyph. The
  // window-name and AgentStatus paths remain as fallbacks.
  const resolvedIcon = resolveAgentIcon({ windowName, status, agentName: identity, resourcesDir: '' });
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

function agentNameFromStatus(status?: AgentStatus): AgentName | undefined {
  if (status === undefined) return undefined;
  return status.agent ?? 'claude';
}

export function describeTmuxUnavailableTreeItem(): TmuxUnavailableTreeItemDescription {
  return {
    label: 'tmux ≥3.1 not found · install ↗',
    iconId: 'warning',
    contextValue: 'deck.tmux.unavailable',
    tooltip: 'Install tmux 3.1 or newer to use Deck-managed Terminals.',
  };
}
