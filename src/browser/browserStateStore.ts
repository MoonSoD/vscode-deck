import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Per-Worktree DeckBrowser bookkeeping that must survive an extension-host reload
// (the detached Chrome instances outlive it) and be visible to other windows (a
// second window reads the debug port to reveal the same instance). File-backed
// under deckDir — not globalState — for the same reason as the pending-open
// queue: globalState is cached per window and never reaches a running peer.
//
// A stale entry after a reboot (Chrome gone) is harmless: the CDP version probe
// finds the port dead and the controller reallocates.
export interface BrowserWorktreeState {
  debugPort?: number;
  profileSeeded?: boolean;
  pid?: number;
}

type StateFile = Record<string, BrowserWorktreeState>;

export class BrowserStateStore {
  // Mutations are chained so concurrent patches within one window don't clobber
  // each other's read-modify-write. Cross-window races are still possible but
  // self-heal via the version probe.
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly now: () => number = Date.now,
  ) {}

  async all(): Promise<StateFile> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.filePath, 'utf8'));
      return isRecord(parsed) ? (parsed as StateFile) : {};
    } catch {
      return {};
    }
  }

  async get(worktreePath: string): Promise<BrowserWorktreeState> {
    return (await this.all())[key(worktreePath)] ?? {};
  }

  async patch(worktreePath: string, patch: BrowserWorktreeState): Promise<BrowserWorktreeState> {
    return this.enqueue(async () => {
      const all = await this.all();
      const merged = { ...(all[key(worktreePath)] ?? {}), ...patch };
      all[key(worktreePath)] = merged;
      await this.write(all);
      return merged;
    });
  }

  async delete(worktreePath: string): Promise<void> {
    await this.enqueue(async () => {
      const all = await this.all();
      delete all[key(worktreePath)];
      await this.write(all);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation, operation);
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }

  private async write(all: StateFile): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${this.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(all));
    await rename(tmp, this.filePath);
  }
}

function key(worktreePath: string): string {
  return resolve(worktreePath);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
