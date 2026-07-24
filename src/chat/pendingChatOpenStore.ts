import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export interface Disposable {
  dispose(): void;
}

const DEFAULT_TTL_MS = 60_000;

// Cross-window queue for "open this ChatSession in its worktree's window". Unlike
// globalState — which each window caches in memory at startup, so an
// already-running window never sees a new entry — this is a watched directory:
// the window mounted on the target worktree observes the file the moment another
// window writes it (on focus, after VS Code brings that window forward), and
// consumes it. One file per worktree, keyed by resolved path; entries expire so a
// stale queue never re-opens a session much later.
export class PendingChatOpenStore {
  private watcher: FSWatcher | undefined;
  private readonly listeners = new Set<() => void>();
  private debounceTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly dir: string,
    private readonly now: () => number = Date.now,
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly debounceMs = 100,
  ) {}

  async set(worktreePath: string, sessionId: string): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.filePath(worktreePath);
    const tmp = `${target}.${this.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify({ sessionId, createdAt: this.now() })}\n`);
    await rename(tmp, target);
  }

  async consume(worktreePath: string): Promise<string | undefined> {
    const target = this.filePath(worktreePath);
    let raw: string;
    try {
      raw = await readFile(target, 'utf8');
    } catch {
      return undefined;
    }
    await unlink(target).catch(() => undefined);
    try {
      const parsed = JSON.parse(raw) as { sessionId?: unknown; createdAt?: unknown };
      if (typeof parsed.sessionId !== 'string' || typeof parsed.createdAt !== 'number') return undefined;
      if (this.now() - parsed.createdAt > this.ttlMs) return undefined;
      return parsed.sessionId;
    } catch {
      return undefined;
    }
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async start(): Promise<Disposable> {
    await mkdir(this.dir, { recursive: true });
    this.watchDir();
    return {
      dispose: () => {
        if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
        this.debounceTimer = undefined;
        this.watcher?.close();
        this.watcher = undefined;
      },
    };
  }

  private watchDir(): void {
    try {
      this.watcher = watch(this.dir, () => this.scheduleNotify());
      this.watcher.on('error', () => {
        this.watcher = undefined;
      });
    } catch {
      this.watcher = undefined;
    }
  }

  private scheduleNotify(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      for (const listener of this.listeners) listener();
    }, this.debounceMs);
  }

  // Pruning is opportunistic: only entries whose worktree window never comes
  // forward linger, and those expire by TTL on the next consume attempt.
  async prune(): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.dir);
    } catch {
      return;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const path = join(this.dir, file);
      try {
        const parsed = JSON.parse(await readFile(path, 'utf8')) as { createdAt?: unknown };
        if (typeof parsed.createdAt === 'number' && this.now() - parsed.createdAt <= this.ttlMs) continue;
      } catch {
        // fall through to unlink unparseable entries
      }
      await unlink(path).catch(() => undefined);
    }
  }

  private filePath(worktreePath: string): string {
    return join(this.dir, `${resolve(worktreePath).replace(/[^a-zA-Z0-9]/g, '-')}.json`);
  }
}
