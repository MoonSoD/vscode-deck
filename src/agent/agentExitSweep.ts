import type { AgentProcessIdentity } from './agentLivenessProbe';
import { AgentLivenessProbe } from './agentLivenessProbe';
import { PaneQuiescence } from './agentPaneQuiescence';
import type { AgentSidecar } from './agentSidecar';
import type { AgentStatus } from './agentStatusStore';
import type { AgentName } from './agentTypes';
import type { Disposable } from './agentStatusStore';

export interface AgentExitSidecarStore {
  readAll(): Promise<Map<string, AgentSidecar>>;
  write(sessionName: string, sidecar: AgentSidecar): Promise<void>;
  remove(sessionName: string): Promise<void>;
}

export interface AgentExitStatusStore {
  get(sessionName: string): AgentStatus | undefined;
  remove(sessionName: string): Promise<void>;
}

export interface AgentExitLiveness {
  isAgentAlive(process: AgentProcessIdentity): Promise<boolean>;
}

export interface AgentExitTeardown {
  restoreAutomaticRename(sessionName: string): Promise<void>;
  renameAgentWindow(sessionName: string, agent: AgentName): Promise<void>;
}

export interface AgentExitServerStart {
  serverStartTime(): Promise<string | undefined>;
}

export interface AgentExitPaneProbe {
  identityForSession(sessionName: string): Promise<AgentProcessIdentity | undefined>;
}

export interface AgentExitPaneCapture {
  capturePane(sessionName: string): Promise<string | undefined>;
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
  paneCapture?: AgentExitPaneCapture;
  intervalMs?: number;
  quiescenceWindowMs?: number;
  now?: () => number;
  onError?: (error: unknown) => void;
}

export class AgentExitSweep implements Disposable {
  private readonly liveness: AgentExitLiveness;
  private readonly quiescence: PaneQuiescence;
  private readonly intervalMs: number;
  private readonly onError: (error: unknown) => void;
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private disposed = false;

  constructor(private readonly options: AgentExitSweepOptions) {
    this.liveness = options.liveness ?? new AgentLivenessProbe();
    this.quiescence = new PaneQuiescence({
      windowMs: options.quiescenceWindowMs ?? 10000,
      now: options.now ?? Date.now,
    });
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
      if (await this.liveness.isAgentAlive(process)) {
        await this.clearQuiescentInProgress(sessionName);
        continue;
      }
      this.quiescence.forget(sessionName);
      // Resolve the tmux server start at most once per sweep — only when a death needs gating.
      if (serverLifetime === undefined) serverLifetime = await this.resolveServerLifetime();
      if (!startedInServerLifetime(sidecar, serverLifetime)) {
        // Adopt only a genuine prior-lifetime death — re-stamp it to the live
        // process in its pane so a resumed-but-never-re-registered agent (Codex)
        // becomes current-lifetime and the quit below can remove it. When the
        // lifetime is unknown or the startTime is unparseable we keep without
        // probing (fail-safe), and never remove here (that would race restore).
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

  private async clearQuiescentInProgress(sessionName: string): Promise<void> {
    const status = this.options.statuses.get(sessionName);
    if (status?.status !== 'inProgress') {
      this.quiescence.forget(sessionName);
      return;
    }

    let capture: string | undefined;
    try {
      capture = await this.options.paneCapture?.capturePane(sessionName);
    } catch (error) {
      this.quiescence.forget(sessionName);
      this.onError(error);
      return;
    }
    if (capture === undefined) {
      this.quiescence.forget(sessionName);
      return;
    }
    if (!this.quiescence.accept(sessionName, capture)) return;

    try {
      await this.options.statuses.remove(sessionName);
      this.quiescence.forget(sessionName);
    } catch (error) {
      this.onError(error);
    }
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
      return;
    }

    // The resumed agent fired no hook, so the row still carries tmux's
    // automatic-rename (the raw binary comm). Restore the agent name the hook
    // would have set on SessionStart.
    try {
      await this.options.teardown.renameAgentWindow(sessionName, sidecar.agent);
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
