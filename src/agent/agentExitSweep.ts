import type { AgentProcessIdentity } from './agentLivenessProbe';
import { AgentLivenessProbe } from './agentLivenessProbe';
import type { AgentStatus, Disposable } from './agentStatusStore';
import type { AgentName } from './agentTypes';

export interface AgentExitPane {
  sessionName: string;
  windowName: string;
}

export interface AgentExitPaneSource {
  listSessions(): Promise<AgentExitPane[]>;
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
}

interface AgentExitSweepOptions {
  panes: AgentExitPaneSource;
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
    const agentPanes = (await this.options.panes.listSessions()).flatMap((pane) => {
      const agent = agentFromWindowName(pane.windowName);
      return agent ? [{ ...pane, agent }] : [];
    });
    if (agentPanes.length === 0) return false;

    let hasProbeableAgent = false;
    for (const pane of agentPanes) {
      const status = this.options.statuses.get(pane.sessionName);
      const process = agentProcess(status, pane.agent);
      if (!process) continue;
      hasProbeableAgent = true;
      if (await this.liveness.isAgentAlive(process)) continue;

      try {
        await this.options.teardown.restoreAutomaticRename(pane.sessionName);
      } catch (error) {
        this.onError(error);
      }
      try {
        await this.options.statuses.remove(pane.sessionName);
      } catch (error) {
        this.onError(error);
      }
    }

    return hasProbeableAgent;
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
      const hasAgentPanes = await this.runOnce();
      if (hasAgentPanes && !this.disposed) {
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

function agentProcess(status: AgentStatus | undefined, fallbackAgent: AgentName): AgentProcessIdentity | undefined {
  if (!status || status.pid === undefined || status.startTime === undefined) return undefined;
  return {
    agent: status.agent ?? fallbackAgent,
    pid: status.pid,
    startTime: status.startTime,
  };
}

function agentFromWindowName(windowName: string): AgentName | undefined {
  if (windowName === 'claude' || windowName === 'codex') return windowName;
  return undefined;
}
