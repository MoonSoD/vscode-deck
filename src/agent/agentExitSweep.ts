import type { AgentProcessIdentity } from './agentLivenessProbe';
import { AgentLivenessProbe } from './agentLivenessProbe';
import type { AgentSidecar } from './agentSidecar';
import type { Disposable } from './agentStatusStore';

export interface AgentExitSidecarStore {
  readAll(): Promise<Map<string, AgentSidecar>>;
  write(sessionName: string, sidecar: AgentSidecar): Promise<void>;
  remove(sessionName: string): Promise<void>;
}

export interface AgentExitStatusStore {
  remove(sessionName: string): Promise<void>;
}

export interface AgentExitLiveness {
  isAgentAlive(process: AgentProcessIdentity): Promise<boolean>;
}

export interface AgentExitTeardown {
  restoreAutomaticRename(sessionName: string): Promise<void>;
}

export interface AgentExitServerStart {
  serverStartTime(): Promise<string | undefined>;
}

export interface AgentExitPaneProbe {
  identityForSession(sessionName: string): Promise<AgentProcessIdentity | undefined>;
}

// Resolved once per sweep: 'no-gate' when no server-start source is wired (reap any
// dead sidecar), 'unknown' when the server start can't be read (keep — fail safe), or
// the parsed server start time to compare each sidecar against.
type ServerLifetime = 'no-gate' | 'unknown' | { startedAt: number };

interface AgentExitSweepOptions {
  sidecars: AgentExitSidecarStore;
  statuses: AgentExitStatusStore;
  teardown: AgentExitTeardown;
  liveness?: AgentExitLiveness;
  serverStart?: AgentExitServerStart;
  paneProbe?: AgentExitPaneProbe;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

export class AgentExitSweep implements Disposable {
  private readonly liveness: AgentExitLiveness;
  private readonly intervalMs: number;
  private readonly onError: (error: unknown) => void;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private disposed = false;

  constructor(private readonly options: AgentExitSweepOptions) {
    this.liveness = options.liveness ?? new AgentLivenessProbe();
    this.intervalMs = options.intervalMs ?? 5000;
    this.onError = options.onError ?? (() => undefined);
  }

  wake(): void {
    if (this.disposed) return;
    void this.runAndSchedule();
  }

  async runOnce(): Promise<boolean> {
    const sidecars = await this.options.sidecars.readAll();
    if (sidecars.size === 0) return false;

    let shouldKeepSweeping = false;
    let serverLifetime: ServerLifetime | undefined;
    for (const [sessionName, sidecar] of sidecars) {
      shouldKeepSweeping = true;
      const process = agentProcess(sidecar);
      if (await this.liveness.isAgentAlive(process)) continue;
      // Resolve the tmux server start at most once per sweep — only when a death needs gating.
      if (serverLifetime === undefined) serverLifetime = await this.resolveServerLifetime();
      if (!startedInServerLifetime(sidecar, serverLifetime)) {
        if (startedBeforeServerLifetime(sidecar, serverLifetime)) {
          await this.adoptLivePaneIdentity(sessionName, sidecar);
        }
        continue;
      }

      try {
        await this.options.sidecars.remove(sessionName);
      } catch (error) {
        this.onError(error);
      }
      try {
        await this.options.teardown.restoreAutomaticRename(sessionName);
      } catch (error) {
        this.onError(error);
      }
      try {
        await this.options.statuses.remove(sessionName);
      } catch (error) {
        this.onError(error);
      }
    }

    return shouldKeepSweeping;
  }

  private async adoptLivePaneIdentity(sessionName: string, sidecar: AgentSidecar): Promise<void> {
    const identity = await this.options.paneProbe?.identityForSession(sessionName);
    if (!identity) return;

    try {
      await this.options.sidecars.write(sessionName, {
        ...sidecar,
        pid: identity.pid,
        startTime: identity.startTime,
      });
    } catch (error) {
      this.onError(error);
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private async runAndSchedule(): Promise<void> {
    if (this.running) return;
    this.running = true;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;

    try {
      const shouldKeepSweeping = await this.runOnce();
      if (shouldKeepSweeping && !this.disposed) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.runAndSchedule();
        }, this.intervalMs);
      }
    } catch (error) {
      this.onError(error);
    } finally {
      this.running = false;
    }
  }

  private async resolveServerLifetime(): Promise<ServerLifetime> {
    if (!this.options.serverStart) return 'no-gate';

    const serverStart = await this.options.serverStart.serverStartTime();
    if (!serverStart) return 'unknown';

    const startedAt = Date.parse(serverStart);
    return Number.isNaN(startedAt) ? 'unknown' : { startedAt };
  }
}

function startedInServerLifetime(sidecar: AgentSidecar, lifetime: ServerLifetime): boolean {
  if (lifetime === 'no-gate') return true;
  if (lifetime === 'unknown') return false;
  const sidecarStartedAt = Date.parse(sidecar.startTime);
  if (Number.isNaN(sidecarStartedAt)) return false;
  return sidecarStartedAt >= lifetime.startedAt;
}

function startedBeforeServerLifetime(sidecar: AgentSidecar, lifetime: ServerLifetime): boolean {
  if (lifetime === 'no-gate' || lifetime === 'unknown') return false;
  const sidecarStartedAt = Date.parse(sidecar.startTime);
  if (Number.isNaN(sidecarStartedAt)) return false;
  return sidecarStartedAt < lifetime.startedAt;
}

function agentProcess(sidecar: AgentSidecar): AgentProcessIdentity {
  return {
    pid: sidecar.pid,
    startTime: sidecar.startTime,
  };
}
