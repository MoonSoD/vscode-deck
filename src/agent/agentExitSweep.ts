import type { AgentProcessIdentity } from './agentLivenessProbe';
import { AgentLivenessProbe } from './agentLivenessProbe';
import type { AgentSidecar } from './agentSidecar';
import type { Disposable } from './agentStatusStore';

export interface AgentExitSidecarStore {
  readAll(): Promise<Map<string, AgentSidecar>>;
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

interface AgentExitSweepOptions {
  sidecars: AgentExitSidecarStore;
  statuses: AgentExitStatusStore;
  teardown: AgentExitTeardown;
  liveness?: AgentExitLiveness;
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
    for (const [sessionName, sidecar] of sidecars) {
      shouldKeepSweeping = true;
      const process = agentProcess(sidecar);
      if (await this.liveness.isAgentAlive(process)) continue;

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
}

function agentProcess(sidecar: AgentSidecar): AgentProcessIdentity {
  return {
    pid: sidecar.pid,
    startTime: sidecar.startTime,
  };
}
