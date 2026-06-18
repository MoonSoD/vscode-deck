import type { AgentStatusDecorationNodeKind, AgentStatusDecorationTerminal } from './agentStatusDecorations';
import {
  agentStatusDecorationResourceUri,
  type AgentStatusDecorationResourceUri,
} from './agentStatusDecorationUris';
import { terminalSessionNumber } from '../terminal/tmuxSafe';

export function agentStatusDecorationInvalidationUris(
  sessionNames: Iterable<string>,
  terminals: readonly AgentStatusDecorationTerminal[],
): AgentStatusDecorationResourceUri[] {
  const terminalsBySession = new Map(terminals.map((terminal) => [terminal.sessionName, terminal]));
  const uris: AgentStatusDecorationResourceUri[] = [];
  const seen = new Set<string>();

  for (const sessionName of sessionNames) {
    addUri(uris, seen, agentStatusDecorationResourceUri('terminal', sessionName));

    const terminal = terminalsBySession.get(sessionName);
    if (terminal === undefined) continue;

    addUri(uris, seen, agentStatusDecorationResourceUri('worktree', terminal.worktreePath));
    addUri(uris, seen, agentStatusDecorationResourceUri('repository', terminal.repositoryPath));

    const tabUri = terminalTabUri(terminal);
    if (tabUri !== undefined) addUri(uris, seen, tabUri);
  }

  return uris;
}

export function agentStatusDecorationCollapseInvalidationUris(
  kind: Exclude<AgentStatusDecorationNodeKind, 'terminal'>,
  id: string,
  terminals: readonly AgentStatusDecorationTerminal[],
): AgentStatusDecorationResourceUri[] {
  const uris: AgentStatusDecorationResourceUri[] = [];
  const seen = new Set<string>();

  addUri(uris, seen, agentStatusDecorationResourceUri(kind, id));
  for (const terminal of terminals) {
    if (!isDescendant(kind, id, terminal)) continue;
    if (kind === 'repository') {
      addUri(uris, seen, agentStatusDecorationResourceUri('worktree', terminal.worktreePath));
    }
    addUri(uris, seen, agentStatusDecorationResourceUri('terminal', terminal.sessionName));
  }

  return uris;
}

function terminalTabUri(terminal: AgentStatusDecorationTerminal): AgentStatusDecorationResourceUri | undefined {
  const term = terminalSessionNumber(terminal.worktreePath, terminal.sessionName);
  if (term < 1) return undefined;
  return {
    scheme: 'deck-terminal',
    authority: '',
    path: `${terminal.worktreePath.replace(/\/+$/, '')}/term-${term}`,
    query: '',
  };
}

function isDescendant(
  kind: Exclude<AgentStatusDecorationNodeKind, 'terminal'>,
  id: string,
  terminal: AgentStatusDecorationTerminal,
): boolean {
  return kind === 'repository'
    ? terminal.repositoryPath === id
    : terminal.worktreePath === id;
}

function addUri(
  uris: AgentStatusDecorationResourceUri[],
  seen: Set<string>,
  uri: AgentStatusDecorationResourceUri,
): void {
  const key = `${uri.scheme}:${uri.authority ?? ''}:${uri.path}:${uri.query ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  uris.push(uri);
}
