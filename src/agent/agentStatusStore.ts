import { statSync, watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export interface AgentStatus {
  status: 'inProgress' | 'needsInput' | 'completed' | 'failed';
  statusAt: number;
  message?: string;
  unread?: boolean;
}

export interface Disposable {
  dispose(): void;
}

type WatchListener = (eventType: string, filename: string | Buffer | null) => void;

export class AgentStatusStore {
  private statuses = new Map<string, AgentStatus>();
  private readMarkers = new Map<string, number>();
  private readonly listeners = new Set<() => void>();
  private readonly readRoot: string;
  private readonly parentRoot: string;
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly watchedInodes = new Map<string, number>();
  private debounceTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly root: string,
    private readonly debounceMs = 100,
    readRoot?: string,
  ) {
    this.readRoot = readRoot ?? `${root}-reads`;
    this.parentRoot = dirname(root);
  }

  get(sessionName: string): AgentStatus | undefined {
    return this.withReadState(sessionName, this.statuses.get(sessionName));
  }

  entries(): IterableIterator<[string, AgentStatus]> {
    return this.statuses.entries();
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  async start(): Promise<Disposable> {
    await this.ensureRoots();
    await this.reload(false);
    this.ensureWatchers();

    return {
      dispose: () => {
        if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
        this.debounceTimer = undefined;
        this.closeWatchers();
      },
    };
  }

  async prune(liveSessionNames: ReadonlySet<string>): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.root);
    } catch (error) {
      if (!isNotFound(error)) throw error;
      files = [];
    }

    await this.pruneFiles(this.root, files, liveSessionNames);
    await this.pruneReadMarkers(liveSessionNames);
    await this.reload();
  }

  // For Deck-owned kills (TerminalRemoval, WorktreeRemoval cascade): the agent
  // never fires SessionEnd under tmux kill-session, so the file must go here.
  async remove(sessionName: string): Promise<void> {
    await this.unlinkIfExists(this.statusPath(sessionName));
    await this.unlinkIfExists(this.readMarkerPath(sessionName));

    const removedStatus = this.statuses.delete(sessionName);
    const removedReadMarker = this.readMarkers.delete(sessionName);
    if (removedStatus || removedReadMarker) {
      for (const listener of this.listeners) listener();
    }
  }

  async markRead(sessionName: string): Promise<void> {
    const status = this.statuses.get(sessionName);
    if (status?.status !== 'completed') return;
    if ((this.readMarkers.get(sessionName) ?? 0) >= status.statusAt) return;

    await mkdir(this.readRoot, { recursive: true });
    await writeFile(this.readMarkerPath(sessionName), `${JSON.stringify({ statusAt: status.statusAt })}\n`);
    this.readMarkers.set(sessionName, status.statusAt);
    for (const listener of this.listeners) listener();
  }

  private scheduleReload(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      this.reload().catch((error) => {
        console.warn('Deck: reading agent status files failed', error);
      });
    }, this.debounceMs);
  }

  private async reload(fire = true): Promise<void> {
    await this.ensureRoots();
    this.ensureWatchers();
    const nextStatuses = await this.readAll();
    const nextReadMarkers = await this.readMarkersAll();
    await this.pruneOrphanReadMarkers(nextStatuses, nextReadMarkers);
    if (sameStatuses(this.statuses, nextStatuses) && sameReadMarkers(this.readMarkers, nextReadMarkers)) return;

    this.statuses = nextStatuses;
    this.readMarkers = nextReadMarkers;
    if (fire) {
      for (const listener of this.listeners) listener();
    }
  }

  private async ensureRoots(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await mkdir(this.readRoot, { recursive: true });
  }

  private ensureWatchers(): void {
    // The parent watch only nudges a reload — never resets child watchers. On
    // macOS a parent dir reports writes *inside* a child dir (the child's mtime
    // bumps), so resetting child watchers from parent events churned them on
    // every status write. Child watchers are re-created only on real
    // recreation, detected by inode below.
    this.ensureWatcher(this.parentRoot, () => this.scheduleReload());
    this.reconcileChildWatcher(this.root);
    this.reconcileChildWatcher(this.readRoot);
  }

  // (Re)watch a status dir only when it is unwatched or was deleted+recreated
  // (its inode changed). An ordinary write keeps the same inode, so this never
  // closes/reopens a live watcher — the churn #104 set out to remove.
  private reconcileChildWatcher(root: string): void {
    let inode: number;
    try {
      inode = statSync(root).ino;
    } catch (error) {
      if (isNotFound(error)) return; // ensureRoots recreates it before the next reconcile
      throw error;
    }
    if (this.watchers.has(root) && this.watchedInodes.get(root) === inode) return;
    this.resetWatcher(root, () => this.scheduleReload());
    this.watchedInodes.set(root, inode);
  }

  private ensureWatcher(root: string, onChange: WatchListener): void {
    if (this.watchers.has(root)) return;
    this.watchPath(root, onChange);
  }

  private resetWatcher(root: string, onChange: WatchListener): void {
    const previous = this.watchers.get(root);
    if (previous) {
      this.watchers.delete(root);
      previous.close();
    }
    this.watchPath(root, onChange);
  }

  private watchPath(root: string, onChange: WatchListener): void {
    try {
      const watcher = watch(root, onChange);
      watcher.on('error', () => {
        if (this.watchers.get(root) === watcher) {
          this.watchers.delete(root);
        }
        this.scheduleReload();
      });
      this.watchers.set(root, watcher);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }

  private closeWatchers(): void {
    for (const root of [this.parentRoot, this.root, this.readRoot]) {
      const watcher = this.watchers.get(root);
      if (!watcher) continue;
      this.watchers.delete(root);
      watcher.close();
    }
    this.watchedInodes.clear();
  }

  private async readAll(): Promise<Map<string, AgentStatus>> {
    let files: string[];
    try {
      files = await readdir(this.root);
    } catch (error) {
      if (isNotFound(error)) return new Map();
      throw error;
    }

    const statuses = new Map<string, AgentStatus>();
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const status = await this.readFile(file);
      if (status) statuses.set(file.slice(0, -'.json'.length), status);
    }
    return statuses;
  }

  private async readFile(file: string): Promise<AgentStatus | undefined> {
    try {
      return parseStatus(await readFile(join(this.root, file), 'utf8'));
    } catch (error) {
      if (isNotFound(error) || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  private async readMarkersAll(): Promise<Map<string, number>> {
    let files: string[];
    try {
      files = await readdir(this.readRoot);
    } catch (error) {
      if (isNotFound(error)) return new Map();
      throw error;
    }

    const readMarkers = new Map<string, number>();
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const statusAt = await this.readMarkerFile(file);
      if (statusAt !== undefined) readMarkers.set(file.slice(0, -'.json'.length), statusAt);
    }
    return readMarkers;
  }

  private async readMarkerFile(file: string): Promise<number | undefined> {
    try {
      return parseReadMarker(await readFile(join(this.readRoot, file), 'utf8'));
    } catch (error) {
      if (isNotFound(error) || error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  private withReadState(sessionName: string, status: AgentStatus | undefined): AgentStatus | undefined {
    if (status?.status !== 'completed') return status;
    const readStatusAt = this.readMarkers.get(sessionName);
    return {
      ...status,
      unread: readStatusAt === undefined || status.statusAt > readStatusAt,
    };
  }

  private async pruneReadMarkers(liveSessionNames: ReadonlySet<string>): Promise<void> {
    let files: string[];
    try {
      files = await readdir(this.readRoot);
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }
    await this.pruneFiles(this.readRoot, files, liveSessionNames);
  }

  private async pruneOrphanReadMarkers(
    statuses: ReadonlyMap<string, AgentStatus>,
    readMarkers: Map<string, number>,
  ): Promise<void> {
    for (const sessionName of readMarkers.keys()) {
      if (statuses.has(sessionName)) continue;
      await this.unlinkIfExists(this.readMarkerPath(sessionName));
      readMarkers.delete(sessionName);
    }
  }

  private async pruneFiles(root: string, files: readonly string[], liveSessionNames: ReadonlySet<string>): Promise<void> {
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const sessionName = file.slice(0, -'.json'.length);
      if (liveSessionNames.has(sessionName)) continue;
      await this.unlinkIfExists(join(root, file));
    }
  }

  private statusPath(sessionName: string): string {
    return join(this.root, `${sessionName}.json`);
  }

  private readMarkerPath(sessionName: string): string {
    return join(this.readRoot, `${sessionName}.json`);
  }

  private async unlinkIfExists(path: string): Promise<void> {
    try {
      await unlink(path);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
  }
}

function parseStatus(text: string): AgentStatus | undefined {
  const value: unknown = JSON.parse(text);
  if (
    typeof value === 'object' &&
    value !== null &&
    isAgentStatusValue((value as { status?: unknown }).status) &&
    typeof (value as { statusAt?: unknown }).statusAt === 'number' &&
    (
      (value as { message?: unknown }).message === undefined ||
      typeof (value as { message?: unknown }).message === 'string'
    )
  ) {
    const status = value as AgentStatus;
    // An empty message defeats ?? fallbacks downstream; treat it as absent.
    return status.message === '' ? { ...status, message: undefined } : status;
  }
  return undefined;
}

function isAgentStatusValue(value: unknown): value is AgentStatus['status'] {
  return value === 'inProgress' || value === 'needsInput' || value === 'completed' || value === 'failed';
}

function parseReadMarker(text: string): number | undefined {
  const value: unknown = JSON.parse(text);
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { statusAt?: unknown }).statusAt !== 'number'
  ) {
    return undefined;
  }
  return (value as { statusAt: number }).statusAt;
}

// "Same" means rendering-equivalent: statusAt only shows through the unread
// bit on completed, so an inProgress statusAt bump (every tool call) is not a
// change — treating it as one re-renders the whole tree once per tool call.
function sameStatuses(left: ReadonlyMap<string, AgentStatus>, right: ReadonlyMap<string, AgentStatus>): boolean {
  if (left.size !== right.size) return false;
  for (const [sessionName, status] of left) {
    const other = right.get(sessionName);
    if (
      !other ||
      other.status !== status.status ||
      other.message !== status.message ||
      (status.status === 'completed' && other.statusAt !== status.statusAt)
    ) {
      return false;
    }
  }
  return true;
}

function sameReadMarkers(left: ReadonlyMap<string, number>, right: ReadonlyMap<string, number>): boolean {
  if (left.size !== right.size) return false;
  for (const [sessionName, statusAt] of left) {
    if (right.get(sessionName) !== statusAt) return false;
  }
  return true;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
