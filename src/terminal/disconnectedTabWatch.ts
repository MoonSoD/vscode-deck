import * as vscode from 'vscode';
import { planReopenUnwiredTerminalTabs, type ReopenPlanOperation, type ReopenPlanSnapshot } from './reopenPlan';
import { SessionUriCodec, terminalUriScheme } from './sessionUriCodec';
import { terminalEditorViewType } from './terminalEditorProvider';

const STARTUP_GRACE_MS = 1000;
const ACTIVATION_GRACE_MS = 500;
const PROMPT_THROTTLE_MS = 30_000;
const REOPEN_LABEL = 'Reopen Terminals';

export interface DisconnectedDeckTab {
  readonly sessionName: string;
  readonly uri: vscode.Uri;
  readonly isActive: boolean;
}

export interface DisconnectedTabWatchSurface {
  activeDeckTabs(): readonly DisconnectedDeckTab[];
  onDidChangeTabs(listener: (event: { closedSessionNames: readonly string[] }) => void): vscode.Disposable;
}

interface DisconnectedTabWatchNotifications {
  showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
}

interface TimerPort {
  setTimeout(handler: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

interface DisconnectedTabWatchOptions {
  surface?: DisconnectedTabWatchSurface;
  panelFor?: (sessionName: string) => unknown;
  notifications?: DisconnectedTabWatchNotifications;
  timers?: TimerPort;
  reopen?: () => Promise<void>;
}

interface PanelRegistryLike {
  panelFor(sessionName: string): unknown;
}

export class DisconnectedTabWatch implements vscode.Disposable {
  private readonly surface: DisconnectedTabWatchSurface;
  private readonly panelFor: (sessionName: string) => unknown;
  private readonly notifications: DisconnectedTabWatchNotifications;
  private readonly timers: TimerPort;
  private readonly reopen: () => Promise<void>;
  private readonly disconnected = new Map<string, vscode.Uri>();
  private readonly listeners = new Set<(uris: readonly vscode.Uri[]) => void>();
  private readonly pendingJudgments = new Map<string, unknown>();
  private startupJudgment: unknown;
  private subscriptions: vscode.Disposable[] = [];
  private lastPromptAt = -Infinity;
  private disposed = false;

  constructor(options: DisconnectedTabWatchOptions);
  constructor(panels: PanelRegistryLike, options?: DisconnectedTabWatchOptions);
  constructor(
    panelsOrOptions: PanelRegistryLike | DisconnectedTabWatchOptions,
    maybeOptions: DisconnectedTabWatchOptions = {},
  ) {
    const options = isPanelRegistry(panelsOrOptions) ? maybeOptions : panelsOrOptions;
    const panels = isPanelRegistry(panelsOrOptions) ? panelsOrOptions : undefined;
    this.surface = options.surface ?? new VsCodeDisconnectedTabSurface();
    this.panelFor = options.panelFor ?? ((sessionName) => panels?.panelFor(sessionName));
    this.notifications = options.notifications ?? vscode.window;
    this.timers = options.timers ?? {
      setTimeout: (handler, ms) => setTimeout(handler, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      now: () => Date.now(),
    };
    this.reopen = options.reopen ?? (() => reopenUnwiredTerminalTabs(panels));
  }

  start(): void {
    if (this.disposed) return;
    this.subscriptions.push(
      this.surface.onDidChangeTabs((event) => this.onTabsChanged(event)),
    );
    this.startupJudgment = this.timers.setTimeout(() => {
      this.startupJudgment = undefined;
      this.judgeActiveDeckTabs();
    }, STARTUP_GRACE_MS);
  }

  isDisconnected(sessionName: string): boolean {
    return this.disconnected.has(sessionName);
  }

  onDidChangeDisconnectedTabs(listener: (uris: readonly vscode.Uri[]) => void): vscode.Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async reopenUnwiredTabs(): Promise<void> {
    await this.reopen();
    this.clearDisconnected();
  }

  dispose(): void {
    this.disposed = true;
    if (this.startupJudgment) this.timers.clearTimeout(this.startupJudgment);
    this.startupJudgment = undefined;
    for (const handle of this.pendingJudgments.values()) this.timers.clearTimeout(handle);
    this.pendingJudgments.clear();
    for (const subscription of this.subscriptions.splice(0)) subscription.dispose();
    this.listeners.clear();
  }

  private onTabsChanged(event: { closedSessionNames: readonly string[] }): void {
    for (const sessionName of event.closedSessionNames) this.forget(sessionName);

    for (const tab of this.surface.activeDeckTabs()) {
      if (this.disconnected.has(tab.sessionName)) {
        this.offerReopen();
        continue;
      }
      this.scheduleJudgment(tab.sessionName);
    }
  }

  private scheduleJudgment(sessionName: string): void {
    const previous = this.pendingJudgments.get(sessionName);
    if (previous) this.timers.clearTimeout(previous);
    const handle = this.timers.setTimeout(() => {
      this.pendingJudgments.delete(sessionName);
      this.judgeActiveDeckTabs();
    }, ACTIVATION_GRACE_MS);
    this.pendingJudgments.set(sessionName, handle);
  }

  private judgeActiveDeckTabs(): void {
    for (const tab of this.surface.activeDeckTabs()) {
      if (this.panelFor(tab.sessionName)) continue;
      this.markDisconnected(tab.sessionName, tab.uri);
    }
  }

  private markDisconnected(sessionName: string, uri: vscode.Uri): void {
    if (this.disconnected.has(sessionName)) return;
    this.disconnected.set(sessionName, uri);
    this.fire([uri]);
    this.offerReopen();
  }

  private forget(sessionName: string): void {
    const uri = this.disconnected.get(sessionName);
    this.pendingJudgments.delete(sessionName);
    if (uri === undefined) return;
    this.disconnected.delete(sessionName);
    this.fire([uri]);
  }

  private clearDisconnected(): void {
    const uris = [...this.disconnected.values()];
    this.disconnected.clear();
    this.fire(uris);
  }

  private offerReopen(): void {
    const now = this.timers.now();
    if (now - this.lastPromptAt < PROMPT_THROTTLE_MS) return;
    this.lastPromptAt = now;
    void this.notifications
      .showWarningMessage(
        'Deck Terminal tabs were disconnected by an extension restart.',
        REOPEN_LABEL,
      )
      .then((choice) => {
        if (choice === REOPEN_LABEL) void this.reopenUnwiredTabs();
      });
  }

  private fire(uris: readonly vscode.Uri[]): void {
    if (uris.length === 0) return;
    for (const listener of this.listeners) listener(uris);
  }
}

export async function reopenUnwiredTerminalTabs(panels?: PanelRegistryLike): Promise<void> {
  const surface = new VsCodeDisconnectedTabSurface();
  const snapshot = surface.reopenSnapshot((sessionName) => panels?.panelFor(sessionName) === undefined);
  const operations = planReopenUnwiredTerminalTabs(snapshot);
  const tabsById = surface.tabsById();

  for (const operation of operations) {
    await executeReopenOperation(operation, tabsById);
  }
}

async function executeReopenOperation(
  operation: ReopenPlanOperation,
  tabsById: Map<string, vscode.Tab>,
): Promise<void> {
  if (operation.kind === 'close') {
    const tab = tabsById.get(operation.tabId);
    if (tab) await vscode.window.tabGroups.close(tab, true);
    return;
  }

  if (operation.kind === 'open') {
    await vscode.commands.executeCommand(
      'vscode.openWith',
      operation.uri,
      terminalEditorViewType,
      { viewColumn: operation.viewColumn },
    );
    return;
  }

  if (operation.kind === 'move') {
    await moveActiveEditorToIndex(operation.index);
    return;
  }

  if (operation.kind === 'pin') {
    await vscode.commands.executeCommand('workbench.action.pinEditor');
    return;
  }

  if (operation.viewType) {
    await vscode.commands.executeCommand(
      'vscode.openWith',
      operation.uri,
      operation.viewType,
      { viewColumn: operation.viewColumn },
    );
    return;
  }

  await vscode.commands.executeCommand(
    'vscode.open',
    operation.uri,
    { viewColumn: operation.viewColumn },
  );
}

async function moveActiveEditorToIndex(index: number): Promise<void> {
  await vscode.commands.executeCommand('moveActiveEditor', { to: 'left', by: 'tab', value: 999 });
  if (index > 0) {
    await vscode.commands.executeCommand('moveActiveEditor', { to: 'right', by: 'tab', value: index });
  }
}

class VsCodeDisconnectedTabSurface implements DisconnectedTabWatchSurface {
  private readonly codec = new SessionUriCodec();

  activeDeckTabs(): readonly DisconnectedDeckTab[] {
    return this.deckTabs().filter((tab) => tab.isActive);
  }

  onDidChangeTabs(listener: (event: { closedSessionNames: readonly string[] }) => void): vscode.Disposable {
    return vscode.window.tabGroups.onDidChangeTabs((event) => {
      listener({
        closedSessionNames: event.closed
          .map((tab) => this.decodeDeckTab(tab)?.sessionName)
          .filter((sessionName): sessionName is string => sessionName !== undefined),
      });
    });
  }

  reopenSnapshot(isUnwired: (sessionName: string) => boolean): ReopenPlanSnapshot {
    return {
      groups: vscode.window.tabGroups.all.map((group, groupIndex) => ({
        id: String(groupIndex),
        viewColumn: group.viewColumn,
        isActive: group.isActive,
        activeTabId: group.activeTab ? this.tabId(groupIndex, group.tabs.indexOf(group.activeTab)) : undefined,
        tabs: group.tabs.map((tab, index) => {
          const decoded = this.decodeDeckTab(tab);
          const input = tab.input as { uri?: vscode.Uri; viewType?: string } | undefined;
          return {
            id: this.tabId(groupIndex, index),
            index,
            isActive: tab.isActive,
            isPinned: tab.isPinned,
            isDeckTerminal: decoded !== undefined,
            isUnwired: decoded ? isUnwired(decoded.sessionName) : false,
            canReveal: input?.uri !== undefined,
            uri: decoded?.uri ?? input?.uri,
            viewType: input?.viewType,
          };
        }),
      })),
    };
  }

  tabsById(): Map<string, vscode.Tab> {
    const tabs = new Map<string, vscode.Tab>();
    vscode.window.tabGroups.all.forEach((group, groupIndex) => {
      group.tabs.forEach((tab, index) => tabs.set(this.tabId(groupIndex, index), tab));
    });
    return tabs;
  }

  private deckTabs(): DisconnectedDeckTab[] {
    const tabs: DisconnectedDeckTab[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const decoded = this.decodeDeckTab(tab);
        if (!decoded) continue;
        tabs.push({
          sessionName: decoded.sessionName,
          uri: decoded.uri,
          isActive: tab.isActive,
        });
      }
    }
    return tabs;
  }

  private decodeDeckTab(tab: vscode.Tab): { sessionName: string; uri: vscode.Uri } | undefined {
    const input = tab.input as { viewType?: unknown; uri?: vscode.Uri } | undefined;
    if (input?.viewType !== terminalEditorViewType || input.uri?.scheme !== terminalUriScheme) return undefined;
    try {
      return {
        sessionName: this.codec.decode(input.uri).sessionName,
        uri: input.uri,
      };
    } catch {
      return undefined;
    }
  }

  private tabId(groupIndex: number, tabIndex: number): string {
    return `${groupIndex}:${tabIndex}`;
  }
}

function isPanelRegistry(value: PanelRegistryLike | DisconnectedTabWatchOptions): value is PanelRegistryLike {
  return typeof (value as PanelRegistryLike).panelFor === 'function' &&
    !('surface' in value) &&
    !('notifications' in value) &&
    !('reopen' in value) &&
    !('timers' in value);
}
