import type { MementoLike } from '../switch/activeWorktreeStore';
import type { TmuxSession } from './tmuxCli';
import { terminalSessionNumber } from './tmuxSafe';

export const TERMINAL_SESSION_LIST_CACHE_KEY = 'deck.terminalSessionListCache';
export const TERMINAL_SESSION_LIST_CACHE_SCHEMA_VERSION = 1;

export interface CachedTerminalSession {
  sessionName: string;
  n: number;
  windowName: string;
}

export function toCachedTerminalSessions(
  worktreePath: string,
  sessions: readonly TmuxSession[],
): CachedTerminalSession[] {
  return sessions
    .map((session) => ({
      sessionName: session.sessionName,
      n: terminalSessionNumber(worktreePath, session.sessionName),
      windowName: session.windowName,
    }))
    .filter((session) => session.n > 0)
    .sort((left, right) => left.n - right.n);
}

interface TerminalSessionListCacheEntry {
  schemaVersion: number;
  terminals: CachedTerminalSession[];
}

export class TerminalSessionListCacheStore {
  constructor(private readonly memento: MementoLike) {}

  get(prefix: string): CachedTerminalSession[] | undefined {
    const entry = this.all()[prefix];
    if (entry?.schemaVersion !== TERMINAL_SESSION_LIST_CACHE_SCHEMA_VERSION) return undefined;
    return entry.terminals;
  }

  async set(prefix: string, terminals: readonly CachedTerminalSession[]): Promise<void> {
    await this.memento.update(TERMINAL_SESSION_LIST_CACHE_KEY, {
      ...this.all(),
      [prefix]: {
        schemaVersion: TERMINAL_SESSION_LIST_CACHE_SCHEMA_VERSION,
        terminals: terminals.map((terminal) => ({ ...terminal })),
      },
    });
  }

  async removeSession(sessionName: string): Promise<void> {
    const all = this.all();
    const next = Object.fromEntries(
      Object.entries(all).map(([prefix, entry]) => [
        prefix,
        {
          ...entry,
          terminals: entry.terminals.filter((terminal) => terminal.sessionName !== sessionName),
        },
      ]),
    );
    await this.memento.update(TERMINAL_SESSION_LIST_CACHE_KEY, next);
  }

  private all(): Record<string, TerminalSessionListCacheEntry> {
    return this.memento.get<Record<string, TerminalSessionListCacheEntry>>(
      TERMINAL_SESSION_LIST_CACHE_KEY,
      {},
    );
  }
}
