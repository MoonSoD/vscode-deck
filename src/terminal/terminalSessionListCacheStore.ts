import type { MementoLike } from '../switch/activeWorktreeStore';

export const TERMINAL_SESSION_LIST_CACHE_KEY = 'deck.terminalSessionListCache';
export const TERMINAL_SESSION_LIST_CACHE_SCHEMA_VERSION = 1;

export interface CachedTerminalSession {
  sessionName: string;
  n: number;
  windowName: string;
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
