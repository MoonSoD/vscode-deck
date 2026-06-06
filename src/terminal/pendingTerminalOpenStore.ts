import type { MementoLike } from '../switch/activeWorktreeStore';

export const PENDING_TERMINAL_OPEN_KEY = 'deck.pendingTerminalOpen';
export const PENDING_TERMINAL_OPEN_SCHEMA_VERSION = 1;
export const PENDING_TERMINAL_OPEN_TTL_MS = 60_000;

type MaybePromise<T> = T | PromiseLike<T>;

interface PendingTerminalOpenEntry {
  sessionName: string;
  createdAt: number;
}

interface PendingTerminalOpenStored {
  schemaVersion: number;
  entries: Record<string, PendingTerminalOpenEntry>;
}

export class PendingTerminalOpenStore {
  constructor(
    private readonly memento: MementoLike,
    private readonly now: () => number = Date.now,
  ) {}

  async set(worktreePath: string, sessionName: string): Promise<void> {
    const stored = this.read();
    await this.write({
      schemaVersion: PENDING_TERMINAL_OPEN_SCHEMA_VERSION,
      entries: {
        ...stored.entries,
        [worktreePath]: { sessionName, createdAt: this.now() },
      },
    });
  }

  async consume(worktreePath: string): Promise<string | undefined> {
    const stored = this.pruneExpired(this.read());
    const entry = stored.entries[worktreePath];
    const entries = { ...stored.entries };
    delete entries[worktreePath];
    await this.write({
      schemaVersion: PENDING_TERMINAL_OPEN_SCHEMA_VERSION,
      entries,
    });
    return entry?.sessionName;
  }

  private read(): PendingTerminalOpenStored {
    const stored = this.memento.get<PendingTerminalOpenStored | undefined>(
      PENDING_TERMINAL_OPEN_KEY,
      undefined,
    );
    if (stored?.schemaVersion !== PENDING_TERMINAL_OPEN_SCHEMA_VERSION) {
      return { schemaVersion: PENDING_TERMINAL_OPEN_SCHEMA_VERSION, entries: {} };
    }
    return stored;
  }

  private pruneExpired(stored: PendingTerminalOpenStored): PendingTerminalOpenStored {
    const cutoff = this.now() - PENDING_TERMINAL_OPEN_TTL_MS;
    return {
      schemaVersion: PENDING_TERMINAL_OPEN_SCHEMA_VERSION,
      entries: Object.fromEntries(
        Object.entries(stored.entries).filter(([, entry]) => entry.createdAt >= cutoff),
      ),
    };
  }

  private async write(value: PendingTerminalOpenStored): Promise<void> {
    await (this.memento.update(PENDING_TERMINAL_OPEN_KEY, value) as MaybePromise<void>);
  }
}
