import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const RECOVERY_LOCK_FILENAME = 'deck-socket-recovery.lock';
export const RESTORE_LOCK_FILENAME = 'deck-socket-restore.lock';

export interface RecoveryLockFileHandle {
  writeFile(data: string): Promise<void>;
  close(): Promise<void>;
}

export interface RecoveryLockFs {
  mkdir(path: string, options: { recursive: true }): Promise<void>;
  open(path: string, flags: number): Promise<RecoveryLockFileHandle>;
  readFile(path: string, encoding: 'utf8'): Promise<string>;
  stat(path: string): Promise<{ mtimeMs: number }>;
  rm(path: string, options: { force: true }): Promise<void>;
}

export interface RecoveryLockClock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface RecoveryLockOptions {
  deckDir: string;
  isHealthy(): Promise<boolean>;
  lockFilename?: string;
  fs?: RecoveryLockFs;
  clock?: RecoveryLockClock;
  ttlMs?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export class RecoveryLock {
  private readonly lockPath: string;
  private readonly fs: RecoveryLockFs;
  private readonly clock: RecoveryLockClock;
  private readonly ttlMs: number;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly ownerToken = randomUUID();
  private held = false;

  constructor(private readonly options: RecoveryLockOptions) {
    this.lockPath = join(options.deckDir, options.lockFilename ?? RECOVERY_LOCK_FILENAME);
    this.fs = options.fs ?? nodeFs;
    this.clock = options.clock ?? realClock;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? this.ttlMs + this.pollIntervalMs;
  }

  async acquire(): Promise<boolean> {
    await this.fs.mkdir(this.options.deckDir, { recursive: true });
    if (await this.tryCreate()) return true;

    let mtimeMs: number;
    try {
      mtimeMs = (await this.fs.stat(this.lockPath)).mtimeMs;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return this.tryCreate();
    }

    if (this.clock.now() - mtimeMs <= this.ttlMs) return false;

    await this.fs.rm(this.lockPath, { force: true });
    return this.tryCreate();
  }

  async acquireBlocking(): Promise<boolean> {
    const deadline = this.clock.now() + this.timeoutMs;
    while (this.clock.now() <= deadline) {
      if (await this.acquire()) return true;
      const delayMs = Math.min(this.pollIntervalMs, deadline - this.clock.now());
      if (delayMs <= 0) break;
      await this.clock.sleep(delayMs);
    }
    return false;
  }

  async release(): Promise<void> {
    if (!this.held) return;
    this.held = false;

    let ownerToken: string;
    try {
      ownerToken = await this.fs.readFile(this.lockPath, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }

    if (ownerToken !== this.ownerToken) return;

    await this.fs.rm(this.lockPath, { force: true });
  }

  async waitForHealthy(): Promise<void> {
    const deadline = this.clock.now() + this.timeoutMs;
    while (this.clock.now() <= deadline) {
      if (await this.options.isHealthy()) return;
      const delayMs = Math.min(this.pollIntervalMs, deadline - this.clock.now());
      if (delayMs <= 0) break;
      await this.clock.sleep(delayMs);
    }
    throw new Error('Timed out waiting for DeckSocket recovery');
  }

  private async tryCreate(): Promise<boolean> {
    try {
      const handle = await this.fs.open(
        this.lockPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      );
      await handle.writeFile(this.ownerToken);
      await handle.close();
      this.held = true;
      return true;
    } catch (error) {
      if (isAlreadyExists(error)) return false;
      throw error;
    }
  }
}

const nodeFs: RecoveryLockFs = {
  mkdir: async (path, options) => {
    await mkdir(path, options);
  },
  open,
  readFile,
  stat,
  rm,
};

const realClock: RecoveryLockClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

function isAlreadyExists(error: unknown): boolean {
  return errorCode(error) === 'EEXIST';
}

function isNotFound(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

function errorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}
