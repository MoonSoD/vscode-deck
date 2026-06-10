import { watch } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface AgentStatus {
  status: 'completed';
  statusAt: number;
}

export interface Disposable {
  dispose(): void;
}

export class AgentStatusStore {
  private statuses = new Map<string, AgentStatus>();
  private readonly listeners = new Set<() => void>();
  private debounceTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly root: string,
    private readonly debounceMs = 100,
  ) {}

  get(sessionName: string): AgentStatus | undefined {
    return this.statuses.get(sessionName);
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
    await mkdir(this.root, { recursive: true });
    await this.reload(false);

    const watcher = watch(this.root, () => {
      this.scheduleReload();
    });

    return {
      dispose: () => {
        if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
        this.debounceTimer = undefined;
        watcher.close();
      },
    };
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
    const next = await this.readAll();
    if (sameStatuses(this.statuses, next)) return;

    this.statuses = next;
    if (fire) {
      for (const listener of this.listeners) listener();
    }
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
}

function parseStatus(text: string): AgentStatus | undefined {
  const value: unknown = JSON.parse(text);
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { status?: unknown }).status === 'completed' &&
    typeof (value as { statusAt?: unknown }).statusAt === 'number'
  ) {
    return value as AgentStatus;
  }
  return undefined;
}

function sameStatuses(left: ReadonlyMap<string, AgentStatus>, right: ReadonlyMap<string, AgentStatus>): boolean {
  if (left.size !== right.size) return false;
  for (const [sessionName, status] of left) {
    const other = right.get(sessionName);
    if (!other || other.status !== status.status || other.statusAt !== status.statusAt) return false;
  }
  return true;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
