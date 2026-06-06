import * as path from 'node:path';
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
    const key = normalizeKey(worktreePath);
    const { stored } = this.read();
    await this.write({
      schemaVersion: PENDING_TERMINAL_OPEN_SCHEMA_VERSION,
      entries: {
        ...stored.entries,
        [key]: { sessionName, createdAt: this.now() },
      },
    });
  }

  // Read-only. Prunes expired entries (writing back only if any expired or
  // the on-disk schema mismatched) so the caller can decide whether to
  // commit a consume after additional checks (e.g. confirming the tmux
  // session still exists).
  async peek(worktreePath: string): Promise<string | undefined> {
    const key = normalizeKey(worktreePath);
    const { stored, wasReset } = this.read();
    const { pruned, expiredCount } = pruneExpired(stored, this.now());
    if (wasReset || expiredCount > 0) await this.write(pruned);
    return pruned.entries[key]?.sessionName;
  }

  async consume(worktreePath: string): Promise<string | undefined> {
    const key = normalizeKey(worktreePath);
    const { stored, wasReset } = this.read();
    const { pruned, expiredCount } = pruneExpired(stored, this.now());
    const entry = pruned.entries[key];
    if (!entry && !wasReset && expiredCount === 0) return undefined;
    const entries = { ...pruned.entries };
    delete entries[key];
    await this.write({
      schemaVersion: PENDING_TERMINAL_OPEN_SCHEMA_VERSION,
      entries,
    });
    return entry?.sessionName;
  }

  private read(): { stored: PendingTerminalOpenStored; wasReset: boolean } {
    const raw = this.memento.get<PendingTerminalOpenStored | undefined>(
      PENDING_TERMINAL_OPEN_KEY,
      undefined,
    );
    if (raw?.schemaVersion !== PENDING_TERMINAL_OPEN_SCHEMA_VERSION) {
      return {
        stored: { schemaVersion: PENDING_TERMINAL_OPEN_SCHEMA_VERSION, entries: {} },
        wasReset: raw !== undefined,
      };
    }
    return { stored: raw, wasReset: false };
  }

  private async write(value: PendingTerminalOpenStored): Promise<void> {
    await (this.memento.update(PENDING_TERMINAL_OPEN_KEY, value) as MaybePromise<void>);
  }
}

// `path.resolve` collapses trailing slashes and `..` segments so writes
// through one form (e.g. `/work/repo/`) match reads through another
// (`/work/repo`). Case-folding deliberately omitted.
function normalizeKey(worktreePath: string): string {
  return path.resolve(worktreePath);
}

function pruneExpired(
  stored: PendingTerminalOpenStored,
  now: number,
): { pruned: PendingTerminalOpenStored; expiredCount: number } {
  const cutoff = now - PENDING_TERMINAL_OPEN_TTL_MS;
  const kept: Record<string, PendingTerminalOpenEntry> = {};
  let expiredCount = 0;
  for (const [key, entry] of Object.entries(stored.entries)) {
    if (entry.createdAt >= cutoff) kept[key] = entry;
    else expiredCount++;
  }
  return {
    pruned: { schemaVersion: PENDING_TERMINAL_OPEN_SCHEMA_VERSION, entries: kept },
    expiredCount,
  };
}
