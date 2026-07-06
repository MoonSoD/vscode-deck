import { agentNameFromWindowName, resolveTerminalLabel } from '../terminal/terminalLabelResolver';
import type { TmuxSession } from '../terminal/tmuxCli';
import type { AgentName } from './agentTypes';
import type { Disposable } from './agentStatusStore';

export interface AgentTitlePollScheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface AgentTitlePollOptions {
  listSessions(): Promise<TmuxSession[]>;
  isFocused(): boolean;
  onDidChangeFocus(listener: (focused: boolean) => void): Disposable;
  scheduler?: AgentTitlePollScheduler;
  intervalMs?: number;
  onError?: (error: unknown) => void;
  resolveAgentName?: (sessionName: string) => Promise<AgentName | undefined>;
}

type ChangeListener = (changedSessions: readonly TmuxSession[]) => void;

export class AgentTitlePoll implements Disposable {
  private readonly scheduler: AgentTitlePollScheduler;
  private readonly intervalMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly listeners = new Set<ChangeListener>();
  private readonly labels = new Map<string, string>();
  private focusSubscription: Disposable | undefined;
  private timer: unknown;
  private running = false;
  private disposed = false;

  constructor(private readonly options: AgentTitlePollOptions) {
    this.scheduler = options.scheduler ?? {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    };
    this.intervalMs = options.intervalMs ?? 2000;
    this.onError = options.onError ?? (() => undefined);
  }

  onChange(listener: ChangeListener): Disposable {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  start(): void {
    if (this.disposed) return;
    if (!this.focusSubscription) {
      this.focusSubscription = this.options.onDidChangeFocus((focused) => {
        if (focused) {
          this.start();
        } else {
          this.clearTimer();
        }
      });
    }
    if (!this.options.isFocused()) return;
    // start() is also the re-arm path: refreshTree() calls it on every tree
    // refresh (so a newly-appeared agent resumes a suspended poll), and a
    // listener may call refreshTree() mid-tick. This guard makes both cheap
    // no-ops while a tick is in flight or scheduled — no double-scheduling, no
    // re-entrancy.
    if (this.running || this.timer !== undefined) return;
    this.runAndSchedule();
  }

  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.focusSubscription?.dispose();
    this.focusSubscription = undefined;
    this.listeners.clear();
  }

  private runAndSchedule(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.clearTimer();

    void this.runOnce()
      .then((hasAgentSession) => {
        if (hasAgentSession && !this.disposed && this.options.isFocused()) {
          this.timer = this.scheduler.setTimeout(() => {
            this.timer = undefined;
            this.runAndSchedule();
          }, this.intervalMs);
        }
      })
      .catch(this.onError)
      .finally(() => {
        this.running = false;
      });
  }

  private async runOnce(): Promise<boolean> {
    const sessions = await this.options.listSessions();
    const agentIdentities = await this.resolveAgentNames(sessions);
    const nextLabels = new Map<string, string>();
    let hasAgentSession = false;
    const changedSessions: TmuxSession[] = [];

    for (const [index, session] of sessions.entries()) {
      const { agentName, explicit } = agentIdentities[index];
      const label = resolveTerminalLabel(session.windowName, session.paneTitle, agentName);
      nextLabels.set(session.sessionName, label);
      if (agentName !== undefined) hasAgentSession = true;
      const previousLabel = this.labels.get(session.sessionName);
      if (previousLabel !== undefined && previousLabel !== label) {
        changedSessions.push(explicit && agentName !== undefined ? { ...session, agentName } : session);
      }
    }

    this.labels.clear();
    for (const [sessionName, label] of nextLabels) {
      this.labels.set(sessionName, label);
    }

    if (changedSessions.length > 0) {
      for (const listener of this.listeners) listener(changedSessions);
    }

    return hasAgentSession;
  }

  private async resolveAgentNames(
    sessions: readonly TmuxSession[],
  ): Promise<Array<{ agentName?: AgentName; explicit: boolean }>> {
    if (this.options.resolveAgentName === undefined) {
      return sessions.map((session) => {
        const agentName = session.agentName ?? agentNameFromWindowName(session.windowName);
        return { agentName, explicit: session.agentName !== undefined };
      });
    }

    return Promise.all(sessions.map(async (session) => {
      const explicitAgentName = session.agentName ?? await this.options.resolveAgentName!(session.sessionName);
      if (explicitAgentName !== undefined) {
        return { agentName: explicitAgentName, explicit: true };
      }
      return { agentName: agentNameFromWindowName(session.windowName), explicit: false };
    }));
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
