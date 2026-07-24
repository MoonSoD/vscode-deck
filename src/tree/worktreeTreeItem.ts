import * as path from 'node:path';
import { Worktree } from '../git/worktrees';
import type { AgentStatus } from '../agent/agentStatusStore';
import type { AgentName } from '../agent/agentTypes';
import {
  type AgentIconFactory,
  type ResolvedAgentIcon,
  resolveAgentIcon,
} from '../agent/agentIconResolver';
import { resolveTerminalLabel } from '../terminal/terminalLabelResolver';
import type { ChatSession } from '../chat/scanChatSessions';

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

export type TerminalTreeIconId = 'terminal' | 'agent-working' | 'agent';

export interface TerminalTreeItemDescription {
  label: string;
  description?: string;
  tooltip?: string;
  iconId: TerminalTreeIconId;
  contextValue: 'deck.terminal.active' | 'deck.terminal.foreign';
}

export interface TerminalTreeItemDescriptionWithIcon<TIconPath> extends TerminalTreeItemDescription {
  iconPath: TIconPath;
}

interface TerminalTreeIconOptions<TUri, TThemeIcon> {
  resourcesDir: string;
  factory: AgentIconFactory<TUri, TThemeIcon>;
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
): TerminalTreeItemDescription;
export function describeTerminalTreeItem<TUri, TThemeIcon>(
  windowName: string,
  isActive: boolean,
  status: AgentStatus | undefined,
  paneTitle: string | undefined,
  agentName: AgentName | undefined,
  icon: TerminalTreeIconOptions<TUri, TThemeIcon>,
): TerminalTreeItemDescriptionWithIcon<TUri | TThemeIcon>;
export function describeTerminalTreeItem<TUri, TThemeIcon>(
  windowName: string,
  isActive: boolean,
  status?: AgentStatus,
  paneTitle?: string,
  agentName?: AgentName,
  icon?: TerminalTreeIconOptions<TUri, TThemeIcon>,
): TerminalTreeItemDescription | TerminalTreeItemDescriptionWithIcon<TUri | TThemeIcon> {
  const contextValue = isActive ? 'deck.terminal.active' : 'deck.terminal.foreign';
  const identity = agentName ?? agentNameFromStatus(status);
  const label = resolveTerminalLabel(windowName, paneTitle, identity);
  // Resolve the icon from the same explicit identity as the label, so a
  // sidecar-only agent (idle, no status file yet) whose window name has gone
  // volatile still shows its mark instead of the plain terminal glyph. The
  // window-name and AgentStatus paths remain as fallbacks.
  const resolvedIcon = resolveAgentIcon(
    { windowName, status, agentName: identity, resourcesDir: icon?.resourcesDir ?? '' },
    icon?.factory,
  );
  const item: TerminalTreeItemDescription = {
    label,
    iconId: terminalTreeIconId(resolvedIcon),
    contextValue,
  };
  if (icon === undefined) return item;
  return { ...item, iconPath: resolvedIcon.iconPath };
}

function terminalTreeIconId(resolvedIcon: ResolvedAgentIcon<unknown, unknown>): TerminalTreeIconId {
  if (resolvedIcon.isAgent && resolvedIcon.state === 'working') return 'agent-working';
  if (resolvedIcon.isAgent) return 'agent';
  return 'terminal';
}

function agentNameFromStatus(status?: AgentStatus): AgentName | undefined {
  if (status === undefined) return undefined;
  return status.agent ?? 'claude';
}

export type ChatSessionTreeIconId = 'agent' | 'agent-working';

export interface ChatSessionTreeItemDescription {
  label: string;
  description: string;
  tooltip: string;
  iconId: ChatSessionTreeIconId;
  contextValue: 'deck.chatSession';
}

export interface ChatSessionTreeItemDescriptionWithIcon<TIconPath>
  extends ChatSessionTreeItemDescription {
  iconPath: TIconPath;
}

interface ChatSessionTreeItemOptions<TUri, TThemeIcon> {
  status?: AgentStatus;
  open?: boolean;
  icon?: TerminalTreeIconOptions<TUri, TThemeIcon>;
}

// A ChatSession row: labelled by its evolving title (or branch, or a generic
// fallback), described by how long ago it was last touched, and — like a
// Terminal — carrying the Claude identity icon, which animates while the agent
// is working. Its AgentStatus drives the same attention decoration Terminals use.
export function describeChatSessionTreeItem(
  session: ChatSession,
  now: number,
  options: ChatSessionTreeItemOptions<never, never> & { icon?: undefined },
): ChatSessionTreeItemDescription;
export function describeChatSessionTreeItem(
  session: ChatSession,
  now: number,
): ChatSessionTreeItemDescription;
export function describeChatSessionTreeItem<TUri, TThemeIcon>(
  session: ChatSession,
  now: number,
  options: ChatSessionTreeItemOptions<TUri, TThemeIcon> & {
    icon: TerminalTreeIconOptions<TUri, TThemeIcon>;
  },
): ChatSessionTreeItemDescriptionWithIcon<TUri | TThemeIcon>;
export function describeChatSessionTreeItem<TUri, TThemeIcon>(
  session: ChatSession,
  now: number,
  options: ChatSessionTreeItemOptions<TUri, TThemeIcon> = {},
): ChatSessionTreeItemDescription | ChatSessionTreeItemDescriptionWithIcon<TUri | TThemeIcon> {
  const label = session.title ?? session.gitBranch ?? 'Claude Code';
  const age = formatRelativeAge(now - session.lastModified);
  // A green dot marks a session whose window is open right now, so a live chat is
  // distinguishable at a glance from the recent-but-closed ones below it.
  const description = options.open ? `🟢 ${age}` : age;
  const resolvedIcon = resolveAgentIcon(
    { windowName: '', status: options.status, agentName: 'claude', resourcesDir: options.icon?.resourcesDir ?? '' },
    options.icon?.factory,
  );
  const item: ChatSessionTreeItemDescription = {
    label,
    description,
    tooltip: chatSessionTooltip(session, age),
    iconId: resolvedIcon.isAgent && resolvedIcon.state === 'working' ? 'agent-working' : 'agent',
    contextValue: 'deck.chatSession',
  };
  if (options.icon === undefined) return item;
  return { ...item, iconPath: resolvedIcon.iconPath };
}

function chatSessionTooltip(session: ChatSession, age: string): string {
  const lines = [session.title ?? 'Claude Code'];
  if (session.gitBranch) lines.push(`on ${session.gitBranch}`);
  lines.push(`Updated ${age} ago`, session.cwd);
  return lines.join('\n');
}

function formatRelativeAge(deltaMs: number): string {
  const seconds = Math.max(0, Math.floor(deltaMs / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function describeTmuxUnavailableTreeItem(): TmuxUnavailableTreeItemDescription {
  return {
    label: 'tmux ≥3.1 not found · install ↗',
    iconId: 'warning',
    contextValue: 'deck.tmux.unavailable',
    tooltip: 'Install tmux 3.1 or newer to use Deck-managed Terminals.',
  };
}
