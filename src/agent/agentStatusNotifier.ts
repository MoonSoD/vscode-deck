import type { AgentStatus, Disposable } from './agentStatusStore';

const OPEN_TERMINAL = 'Open Terminal';

export type AgentStatusNotificationMode = 'off' | 'windowNotFocused' | 'always';

interface AgentStatusStoreLike {
  entries(): Iterable<[string, AgentStatus]>;
  onDidChange(listener: () => void): Disposable;
}

interface AgentStatusNotificationSettings {
  notifyOnNeedsInput(): AgentStatusNotificationMode;
  notifyOnCompleted(): AgentStatusNotificationMode;
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
    this.show(
      this.options.notifications.showWarningMessage(status.message ?? 'Agent needs input', OPEN_TERMINAL),
      sessionName,
    );
  }

  private notifyCompleted(sessionName: string, status: AgentStatus): void {
    if (!this.shouldNotify(sessionName, this.options.settings.notifyOnCompleted())) return;
    this.show(
      this.options.notifications.showInformationMessage(status.message ?? 'Agent completed', OPEN_TERMINAL),
      sessionName,
    );
  }

  private shouldNotify(sessionName: string, mode: AgentStatusNotificationMode): boolean {
    if (mode === 'off') return false;
    if (this.options.windowState.activeTerminalSessionName() === sessionName) return false;
    return mode === 'always' || !this.options.windowState.isFocused();
  }

  private show(choice: Thenable<string | undefined>, sessionName: string): void {
    void choice.then((selected) => {
      if (selected !== OPEN_TERMINAL) return;
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
