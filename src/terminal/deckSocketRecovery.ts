import { join } from 'node:path';

export interface DeckSocketPathOptions {
  env?: Record<string, string | undefined>;
  uid?: number;
}

export interface WedgeRecoveryDeps {
  isServerRunning(): Promise<boolean>;
  startServer(): Promise<void>;
  socketPath(): string;
  socketExists(path: string): Promise<boolean>;
  removeSocket(path: string): Promise<void>;
  recoveryLock: {
    acquire(): Promise<boolean>;
    release(): Promise<void>;
    waitForHealthy(): Promise<boolean>;
  };
}

export interface WedgeRecoveryOutcome {
  recovered: boolean;
  started: boolean;
}

const WEDGE_CONFIRMATION_PROBES = 3;

export class WedgeRecovery {
  constructor(private readonly deps: WedgeRecoveryDeps) {}

  async ensureHealthyServer(): Promise<WedgeRecoveryOutcome> {
    if (await this.deps.isServerRunning()) {
      return { recovered: false, started: false };
    }

    try {
      await this.deps.startServer();
      return { recovered: false, started: true };
    } catch (error) {
      const socketPath = this.deps.socketPath();
      if (!isWedged(error) || !(await this.deps.socketExists(socketPath))) throw error;

      if (!(await this.confirmWedge(socketPath))) return { recovered: false, started: false };

      if (!(await this.deps.recoveryLock.acquire())) {
        await this.deps.recoveryLock.waitForHealthy();
        return { recovered: false, started: false };
      }

      try {
        if (!(await this.confirmWedge(socketPath))) return { recovered: false, started: false };

        await this.deps.removeSocket(socketPath);
        await this.deps.startServer();
        return { recovered: true, started: true };
      } finally {
        await this.deps.recoveryLock.release();
      }
    }
  }

  private async confirmWedge(socketPath: string): Promise<boolean> {
    for (let probe = 0; probe < WEDGE_CONFIRMATION_PROBES; probe += 1) {
      if (!(await this.deps.socketExists(socketPath))) return false;
      if (await this.deps.isServerRunning()) return false;
    }
    return true;
  }
}

export function deckSocketPath(options: DeckSocketPathOptions = {}): string {
  const env = options.env ?? process.env;
  const uid = options.uid ?? process.getuid?.() ?? 0;
  return join(env.TMUX_TMPDIR ?? '/tmp', `tmux-${uid}`, 'deck');
}

export function isWedged(error: unknown): boolean {
  return errorText(error)
    .split(/\r?\n/)
    .some((line) => line.trim() === 'server exited unexpectedly');
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const output = error as { stdout?: unknown; stderr?: unknown };
    return `${stringOutput(output.stdout)}\n${stringOutput(output.stderr)}`;
  }
  return '';
}

function stringOutput(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
