import type { PreviewDefinition } from './previewDefinition';
import { previewPort } from './previewPort';

export interface Disposable {
  dispose(): void;
}

export interface BrowserPollScheduler {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface BrowserPollDeps {
  // The (Worktree, previews) pairs to probe — the PreviewStore's resolved entries.
  previewEntries(): { worktreePath: string; previews: readonly PreviewDefinition[] }[];
  isPortListening(port: number): Promise<boolean>;
  isFocused(): boolean;
  onDidChangeFocus(listener: (focused: boolean) => void): Disposable;
  scheduler?: BrowserPollScheduler;
  intervalMs?: number;
  onError?: (error: unknown) => void;
}

// Observes which PreviewWindows are ON — a focus-gated ~2s tick that TCP-probes
// each preview's deterministic PreviewPort. A preview is ON when its dev server
// is serving that port; that is the signal the tree uses to decide whether to
// show the preview's child row. A poll (not an event source) for the same reason
// ADR-0052/0054 chose one: the latency is sub-human and the mechanism is trivial.
// Its onDidChange is structural — the set of rows changes — so the tree does a
// whole-subtree refresh.
export class BrowserPoll implements Disposable {
  private readonly scheduler: BrowserPollScheduler;
  private readonly intervalMs: number;
  private readonly onError: (error: unknown) => void;
  private readonly listeners = new Set<() => void>();
  private onKeys: ReadonlySet<string> = new Set();
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

  isOn(worktreePath: string, previewName: string): boolean {
    return this.onKeys.has(onKey(worktreePath, previewName));
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
    const nextOnKeys = new Set<string>();

    for (const { worktreePath, previews } of this.deps.previewEntries()) {
      for (const preview of previews) {
        if (await this.deps.isPortListening(previewPort(worktreePath, preview))) {
          nextOnKeys.add(onKey(worktreePath, preview.name));
        }
      }
    }

    if (!sameKeys(this.onKeys, nextOnKeys)) {
      this.onKeys = nextOnKeys;
      for (const listener of this.listeners) listener();
    }
  }

  private clearTimer(): void {
    if (this.timer === undefined) return;
    this.scheduler.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function onKey(worktreePath: string, previewName: string): string {
  return `${worktreePath}::${previewName}`;
}

function sameKeys(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const key of left) {
    if (!right.has(key)) return false;
  }
  return true;
}
