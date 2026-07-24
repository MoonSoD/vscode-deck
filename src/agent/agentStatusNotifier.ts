import type { AgentStatus, Disposable } from './agentStatusStore';
import {
  composeAgentStatusNotificationLine,
  type AgentStatusNotificationLocation,
} from './agentStatusNotificationLine';
import { resolveTerminalLabel } from '../terminal/terminalLabelResolver';
import type { TmuxSession } from '../terminal/tmuxCli';

const OPEN_TERMINAL = 'Open Terminal';

interface AgentStatusStoreLike {
  entries(): Iterable<[string, AgentStatus]>;
  onDidChange(listener: () => void): Disposable;
}

interface AgentStatusNotificationSettings {
  notifyOnNeedsInput(): boolean;
  notifyOnCompleted(): boolean;
}

interface AgentStatusWindowState {
  isFocused(): boolean;
  activeTerminalSessionName(): string | undefined;
}

interface AgentStatusNotifications {
  showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
  showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
}

interface AgentStatusNotifierOptions {
  store: AgentStatusStoreLike;
  settings: AgentStatusNotificationSettings;
  windowState: AgentStatusWindowState;
  notifications: AgentStatusNotifications;
  openTerminal(sessionName: string): void | PromiseLike<void>;
  resolveTerminalSession?(sessionName: string): Promise<TmuxSession | undefined>;
  describeSession?(sessionName: string): Promise<AgentStatusNotificationLocation | undefined>;
  // The reveal action's button text. Defaults to Open Terminal; a ChatSession
  // notifier passes Open, since it reveals a window, not a Terminal.
  actionLabel?: string;
  // Overrides the row label (the AgentTitle for Terminals). A ChatSession has no
  // Terminal to derive one from, so it resolves the session's own title here.
  resolveLabel?(sessionName: string): Promise<string | undefined>;
}

export class AgentStatusNotifier {
  private previous = new Map<string, AgentStatus['status']>();

  constructor(private readonly options: AgentStatusNotifierOptions) {}

  start(): Disposable {
    this.previous = this.snapshot();
    return this.options.store.onDidChange(() => {
      this.handleChange();
    });
  }

  private handleChange(): void {
    const current = this.snapshot();
    for (const [sessionName, status] of this.options.store.entries()) {
      const previousStatus = this.previous.get(sessionName);
      if (status.status === 'needsInput' && previousStatus !== 'needsInput') {
        this.notifyNeedsInput(sessionName, status);
      }
      if (status.status === 'completed' && previousStatus !== 'completed') {
        this.notifyCompleted(sessionName, status);
      }
    }
    this.previous = current;
  }

  private notifyNeedsInput(sessionName: string, status: AgentStatus): void {
    if (!this.shouldNotify(sessionName, this.options.settings.notifyOnNeedsInput())) return;
    void this.notify(sessionName, status, 'needsInput');
  }

  private notifyCompleted(sessionName: string, status: AgentStatus): void {
    if (!this.shouldNotify(sessionName, this.options.settings.notifyOnCompleted())) return;
    void this.notify(sessionName, status, 'completed');
  }

  private async notify(
    sessionName: string,
    status: AgentStatus,
    notificationStatus: 'needsInput' | 'completed',
  ): Promise<void> {
    const [terminal, location, resolvedLabel] = await Promise.all([
      this.resolveTerminalSession(sessionName),
      this.describeSession(sessionName),
      this.resolveLabel(sessionName),
    ]);
    const agentName = status.agent ?? 'claude';
    const label = resolvedLabel ?? (terminal === undefined
      ? agentName
      : resolveTerminalLabel(terminal.windowName, terminal.paneTitle, agentName));
    const line = composeAgentStatusNotificationLine({
      status: notificationStatus,
      agentName,
      label,
      message: status.message,
      location,
    });
    const actionLabel = this.options.actionLabel ?? OPEN_TERMINAL;
    const choice = line.severity === 'warning'
      ? this.options.notifications.showWarningMessage(line.text, actionLabel)
      : this.options.notifications.showInformationMessage(line.text, actionLabel);
    this.show(choice, sessionName, actionLabel);
  }

  private async resolveTerminalSession(sessionName: string): Promise<TmuxSession | undefined> {
    try {
      return await this.options.resolveTerminalSession?.(sessionName);
    } catch {
      return undefined;
    }
  }

  private async describeSession(sessionName: string): Promise<AgentStatusNotificationLocation | undefined> {
    try {
      return await this.options.describeSession?.(sessionName);
    } catch {
      return undefined;
    }
  }

  private async resolveLabel(sessionName: string): Promise<string | undefined> {
    try {
      return await this.options.resolveLabel?.(sessionName);
    } catch {
      return undefined;
    }
  }

  private shouldNotify(sessionName: string, enabled: boolean): boolean {
    if (!enabled) return false;
    // Suppress only when you're actually looking at that terminal: its tab is
    // the active tab AND the window is focused. If the window is unfocused
    // (you're in another window or app) the tab isn't really in front of you,
    // so still notify — the warning toast waits for your return. (A true
    // "reach me anywhere, even another app" channel is the companion app, #102.)
    const looking = this.options.windowState.isFocused()
      && this.options.windowState.activeTerminalSessionName() === sessionName;
    return !looking;
  }

  private show(choice: Thenable<string | undefined>, sessionName: string, actionLabel: string): void {
    void choice.then((selected) => {
      if (selected !== actionLabel) return;
      return this.options.openTerminal(sessionName);
    });
  }

  private snapshot(): Map<string, AgentStatus['status']> {
    return new Map(Array.from(this.options.store.entries(), ([sessionName, status]) => [
      sessionName,
      status.status,
    ]));
  }
}
