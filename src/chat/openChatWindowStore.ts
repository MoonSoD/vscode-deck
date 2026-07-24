import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Disposable {
  dispose(): void;
}

// One VS Code window's snapshot of the Claude chat windows it has open, by title.
export interface OpenChatWindowEntry {
  titles: string[];
  updatedAt: number;
}

// Unions the open-window titles reported by every VS Code window, dropping any
// whose report has gone stale — a window rewrites its file on a heartbeat and
// removes it on close, so an entry older than the TTL is a window that crashed
// without cleaning up, and its titles must not keep a session looking open.
export function unionOpenChatTitles(
  entries: readonly OpenChatWindowEntry[],
  now: number,
  ttlMs: number,
): Set<string> {
  const titles = new Set<string>();
  for (const entry of entries) {
    if (now - entry.updatedAt > ttlMs) continue;
    for (const title of entry.titles) titles.add(title);
  }
  return titles;
}

export interface OpenChatWindowStoreDeps {
  now(): number;
  ttlMs?: number;
  debounceMs?: number;
  // Reads every window's entry (this window's included) from the shared store.
  readAll(): Promise<OpenChatWindowEntry[]>;
  // Writes this window's entry.
  write(entry: OpenChatWindowEntry): Promise<void>;
  // Removes this window's entry (on dispose), so its titles stop counting at once.
  remove(): Promise<void>;
  watch(onChange: () => void): Disposable;
}

const FIVE_MINUTES_MS = 5 * 60 * 1000;

// The cross-window counterpart to reading `vscode.window.tabGroups`: a window
// can only see its own tabs, so each publishes the Claude chat titles it has
// open to a shared directory and every window reads the union. That lets a
// session open in another window be recognised as open here — the gap the
// single-window tab read left (ADR-0053). Titles are all a tab exposes, so the
// match stays title-based; identical titles can still cross over.
export class OpenChatWindowStore {
  private titles: ReadonlySet<string> = new Set();
  private lastPublished: string[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly ttlMs: number;
  private readonly debounceMs: number;
  private debounceTimer: NodeJS.Timeout | undefined;
  private watchHandle: Disposable | undefined;

  constructor(private readonly deps: OpenChatWindowStoreDeps) {
    this.ttlMs = deps.ttlMs ?? FIVE_MINUTES_MS;
    this.debounceMs = deps.debounceMs ?? 200;
  }

  // The unioned open titles across all windows, read synchronously by the tree.
  union(): ReadonlySet<string> {
    return this.titles;
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async start(): Promise<Disposable> {
    await this.refresh(false);
    this.watchHandle = this.deps.watch(() => this.scheduleRefresh());
    return {
      dispose: () => {
        if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
        this.debounceTimer = undefined;
        this.watchHandle?.dispose();
        this.watchHandle = undefined;
        // Best-effort: drop this window's entry so its titles stop counting the
        // moment it closes, rather than lingering until the TTL expires them.
        void this.deps.remove().catch(() => undefined);
      },
    };
  }

  // Records this window's open titles, then recomputes the union so the local
  // window's own tabs are reflected without waiting for the watch to fire.
  async publish(titles: readonly string[]): Promise<void> {
    this.lastPublished = [...titles];
    await this.deps.write({ titles: this.lastPublished, updatedAt: this.deps.now() });
    await this.refresh(true);
  }

  // Rewrites this window's entry with a fresh timestamp so other windows keep
  // seeing it as live — an open-but-idle window changes no tabs, so without this
  // heartbeat its entry would age past the TTL and its sessions look closed.
  async heartbeat(): Promise<void> {
    await this.publish(this.lastPublished);
  }

  private scheduleRefresh(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.refresh(true).catch((error) => {
        console.warn('Deck: reading open Claude chat windows failed', error);
      });
    }, this.debounceMs);
  }

  private async refresh(fire: boolean): Promise<void> {
    const entries = await this.deps.readAll();
    const next = unionOpenChatTitles(entries, this.deps.now(), this.ttlMs);
    if (fire && !sameTitles(this.titles, next)) {
      this.titles = next;
      for (const listener of this.listeners) listener();
      return;
    }
    this.titles = next;
  }
}

function sameTitles(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const title of left) if (!right.has(title)) return false;
  return true;
}

// Wires an OpenChatWindowStore to a real directory (one JSON file per window,
// keyed by a per-window id). Mirrors PendingChatOpenStore's atomic tmp+rename
// writes and tolerant reads so a half-written or malformed file is skipped.
export function createOpenChatWindowStore(options: {
  dir: string;
  windowKey: string;
  now?: () => number;
  ttlMs?: number;
}): OpenChatWindowStore {
  const now = options.now ?? Date.now;
  const fileName = `${options.windowKey.replace(/[^a-zA-Z0-9]/g, '-')}.json`;
  const ownFile = join(options.dir, fileName);

  return new OpenChatWindowStore({
    now,
    ...(options.ttlMs !== undefined ? { ttlMs: options.ttlMs } : {}),
    readAll: async () => {
      await mkdir(options.dir, { recursive: true });
      let files: string[];
      try {
        files = await readdir(options.dir);
      } catch {
        return [];
      }
      const entries: OpenChatWindowEntry[] = [];
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const entry = await readEntrySafe(join(options.dir, file));
        if (entry !== undefined) entries.push(entry);
      }
      return entries;
    },
    write: async (entry) => {
      await mkdir(options.dir, { recursive: true });
      const tmp = `${ownFile}.${now()}.tmp`;
      await writeFile(tmp, `${JSON.stringify(entry)}\n`);
      await rename(tmp, ownFile);
    },
    remove: () => unlink(ownFile).then(() => undefined),
    watch: (onChange) => {
      let watcher: FSWatcher | undefined;
      try {
        watcher = watch(options.dir, () => onChange());
        watcher.on('error', () => undefined);
      } catch {
        watcher = undefined;
      }
      return { dispose: () => watcher?.close() };
    },
  });
}

async function readEntrySafe(filePath: string): Promise<OpenChatWindowEntry | undefined> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { titles?: unknown; updatedAt?: unknown };
    if (!Array.isArray(parsed.titles) || typeof parsed.updatedAt !== 'number') return undefined;
    const titles = parsed.titles.filter((title): title is string => typeof title === 'string');
    return { titles, updatedAt: parsed.updatedAt };
  } catch {
    return undefined;
  }
}
