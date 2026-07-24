import type { PreviewDefinition } from './previewDefinition';
import { previewPort } from './previewPort';
import { targetPort, type CdpTarget } from './cdpClient';

export interface Disposable {
  dispose(): void;
}

export interface BrowserPollScheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BrowserPollDeps {
  // The launched Worktree instances to probe (from the BrowserStateStore).
  worktrees(): Promise<{ worktreePath: string; debugPort: number }[]>;
  previewsFor(worktreePath: string): readonly PreviewDefinition[];
  liveTargets(debugPort: number): Promise<CdpTarget[]>;
  isFocused(): boolean;
  onDidChangeFocus(listener: (focused: boolean) => void): Disposable;
  scheduler?: BrowserPollScheduler;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

// Observes which PreviewWindows are live — the DeckBrowser's TerminalPoll. A
// focus-gated ~2s tick lists each launched Worktree instance's CDP targets and
// matches them to PreviewDefinitions by PreviewPort, maintaining the open set the
// tree badges. A poll (not a CDP event client) for the same reason ADR-0052 chose
// one for Terminals: the latency is sub-human and an event client is far heavier.
export class BrowserPoll implements Disposable {
  private readonly scheduler: BrowserPollScheduler;
  private readonly intervalMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly listeners = new Set<() => void>();
  private openKeys: ReadonlySet<string> = new Set();
  private focusSubscription: Disposable | undefined;
  private timer: unknown;
  private running = false;
  private disposed = false;

  constructor(private readonly deps: BrowserPollDeps) {
    this.scheduler = deps.scheduler ?? {
      setTimeout: (callback, ms) => setTimeout(callback, ms),
      clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
    };
    this.intervalMs = deps.intervalMs ?? 2000;
    this.onError = deps.onError ?? (() => undefined);
  }

  isOpen(worktreePath: string, previewName: string): boolean {
    return this.openKeys.has(openKey(worktreePath, previewName));
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  start(): void {
    if (this.disposed) return;
    if (!this.focusSubscription) {
      this.focusSubscription = this.deps.onDidChangeFocus((focused) => {
        if (focused) this.start();
        else this.clearTimer();
      });
    }
    if (!this.deps.isFocused()) return;
    // start() is also the re-arm path (called on every tree refresh); this guard
    // keeps it cheap while a tick is in flight or scheduled.
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
      .catch(this.onError)
      .finally(() => {
        this.running = false;
        if (!this.disposed && this.deps.isFocused()) {
          this.timer = this.scheduler.setTimeout(() => {
            this.timer = undefined;
            this.runAndSchedule();
          }, this.intervalMs);
        }
      });
  }

  private async runOnce(): Promise<void> {
    const worktrees = await this.deps.worktrees();
    const nextOpenKeys = new Set<string>();

    for (const { worktreePath, debugPort } of worktrees) {
      const previews = this.deps.previewsFor(worktreePath);
      if (previews.length === 0) continue;
      const livePorts = new Set(
        (await this.deps.liveTargets(debugPort))
          .map((target) => targetPort(target.url))
          .filter((port): port is string => port !== undefined),
      );
      for (const preview of previews) {
        if (livePorts.has(String(previewPort(worktreePath, preview)))) {
          nextOpenKeys.add(openKey(worktreePath, preview.name));
        }
      }
    }

    if (!sameKeys(this.openKeys, nextOpenKeys)) {
      this.openKeys = nextOpenKeys;
      for (const listener of this.listeners) listener();
    }
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function openKey(worktreePath: string, previewName: string): string {
  return `${worktreePath}::${previewName}`;
}

function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const key of left) {
    if (!right.has(key)) return false;
  }
  return true;
}
