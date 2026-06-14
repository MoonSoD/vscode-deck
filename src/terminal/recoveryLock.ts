import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { PsProcessProbe, type ProcessProbe } from '../agent/agentLivenessProbe';

export const RECOVERY_LOCK_FILENAME = 'deck-socket-recovery.lock';
export const SNAPSHOT_LOCK_FILENAME = 'deck-socket-snapshot.lock';

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
  processProbe?: Pick<ProcessProbe, 'isAlive' | 'startTime'>;
  ttlMs?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

interface LockOwner {
  ownerToken: string;
  pid: number;
  startTime: string;
}

const DEFAULT_TTL_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 250;

export class RecoveryLock {
  private readonly lockPath: string;
  private readonly fs: RecoveryLockFs;
  private readonly clock: RecoveryLockClock;
  private readonly processProbe: Pick<ProcessProbe, 'isAlive' | 'startTime'>;
  private readonly ttlMs: number;
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly ownerToken = randomUUID();
  private held = false;

  constructor(private readonly options: RecoveryLockOptions) {
    this.lockPath = join(options.deckDir, options.lockFilename ?? RECOVERY_LOCK_FILENAME);
    this.fs = options.fs ?? nodeFs;
    this.clock = options.clock ?? realClock;
    this.processProbe = options.processProbe ?? new PsProcessProbe();
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.timeoutMs = options.timeoutMs ?? this.ttlMs + this.pollIntervalMs;
  }

  async acquire(): Promise<boolean> {
    await this.fs.mkdir(this.options.deckDir, { recursive: true });
    if (await this.tryCreate()) return true;

    let mtimeMs: number;
    let content: string;
    try {
      const [stats, lockContent] = await Promise.all([
        this.fs.stat(this.lockPath),
        this.fs.readFile(this.lockPath, 'utf8'),
      ]);
      mtimeMs = stats.mtimeMs;
      content = lockContent;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      return this.tryCreate();
    }

    const lockOwner = parseLockOwner(content);
    const ttlExpired = this.clock.now() - mtimeMs > this.ttlMs;
    const holderAlive = lockOwner ? await this.isHolderAlive(lockOwner) : true;
    if (holderAlive && !ttlExpired) return false;

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

    let content: string;
    try {
      content = await this.fs.readFile(this.lockPath, 'utf8');
    } catch (error) {
      if (isNotFound(error)) return;
      throw error;
    }

    const lockOwner = parseLockOwner(content);
    const ownerToken = lockOwner?.ownerToken ?? content;
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
      await handle.writeFile(JSON.stringify({
        ownerToken: this.ownerToken,
        pid: process.pid,
        startTime: await this.processProbe.startTime(process.pid),
      }));
      await handle.close();
      this.held = true;
      return true;
    } catch (error) {
      if (isAlreadyExists(error)) return false;
      throw error;
    }
  }

  private async isHolderAlive(lockOwner: LockOwner): Promise<boolean> {
    if (!(await this.processProbe.isAlive(lockOwner.pid))) return false;
    return (await this.processProbe.startTime(lockOwner.pid)) === lockOwner.startTime;
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

function parseLockOwner(content: string): LockOwner | undefined {
  try {
    const value = JSON.parse(content) as unknown;
    if (!value || typeof value !== 'object') return undefined;
    const owner = value as Partial<LockOwner>;
    if (
      typeof owner.ownerToken !== 'string' ||
      typeof owner.pid !== 'number' ||
      typeof owner.startTime !== 'string'
    ) {
      return undefined;
    }
    return {
      ownerToken: owner.ownerToken,
      pid: owner.pid,
      startTime: owner.startTime,
    };
  } catch {
    return undefined;
  }
}
