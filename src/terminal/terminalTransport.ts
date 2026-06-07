import { TmuxControlClient } from './tmuxControlClient';

export interface TmuxControlClientLike {
  start(sessionName: string, cwd: string, seedLines: number): Promise<void> | void;
  onOutput(handler: (data: string) => void): { dispose(): void };
  onSeed(handler: (seed: string) => void): { dispose(): void };
  onExit(handler: (code: number | null) => void): { dispose(): void };
  sendKeys(data: string): Promise<void> | void;
  resize(cols: number, rows: number): Promise<void> | void;
  kill(): void;
}

export type TmuxControlClientFactory = (configPath: string) => TmuxControlClientLike;

const defaultClientFactory: TmuxControlClientFactory = (configPath) =>
  new TmuxControlClient(configPath);

// Matches the webview's xterm scrollback; seeding deeper is wasted writes.
const SEED_LINES = 5000;

export class TerminalTransport {
  private client: TmuxControlClientLike | undefined;
  private startPromise: Promise<void> | undefined;
  private ready = false;
  private exitEmitted = false;
  private pendingSize: { cols: number; rows: number } | undefined;
  private readonly dataHandlers = new Set<(data: string) => void>();
  private readonly exitHandlers = new Set<(code: number) => void>();
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    private readonly configPath: string,
    private readonly clientFactory: TmuxControlClientFactory = defaultClientFactory,
  ) {}

  start(sessionName: string, cwd: string, cols: number, rows: number): void {
    if (this.client) return;
    const size = this.pendingSize ?? { cols, rows };
    this.pendingSize = undefined;

    const client = this.clientFactory(this.configPath);
    this.client = client;
    this.disposables.push(
      client.onSeed((seed) => {
        const scrollback = normalizeSeedNewlines(stripTrailingBlankLines(seed));
        if (scrollback) this.emitData(scrollback);
      }),
      client.onOutput((data) => this.emitData(data)),
      client.onExit((code) => this.emitExit(code ?? 0)),
    );

    this.startPromise = Promise.resolve(client.start(sessionName, cwd, SEED_LINES))
      .then(() => {
        if (this.client === client) this.ready = true;
      })
      .catch((error: unknown) => {
        if (this.client !== client) return;
        console.error('[deck] terminal transport failed to start:', error);
        client.kill();
        this.emitExit(1);
      });
    void Promise.resolve(client.resize(size.cols, size.rows)).catch(() => undefined);
  }

  onData(handler: (data: string) => void): { dispose(): void } {
    this.dataHandlers.add(handler);
    return { dispose: () => this.dataHandlers.delete(handler) };
  }

  onExit(handler: (code: number) => void): { dispose(): void } {
    this.exitHandlers.add(handler);
    return { dispose: () => this.exitHandlers.delete(handler) };
  }

  write(data: string): void {
    const client = this.client;
    if (!client) return;
    if (this.ready) {
      void Promise.resolve(client.sendKeys(data)).catch(() => undefined);
      return;
    }

    void this.startPromise?.then(() => {
      if (this.client === client && this.ready) {
        void Promise.resolve(client.sendKeys(data)).catch(() => undefined);
      }
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.client) {
      this.pendingSize = { cols, rows };
      return;
    }

    void Promise.resolve(this.client.resize(cols, rows)).catch(() => undefined);
  }

  dispose(): void {
    this.kill();
  }

  kill(): void {
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.client?.kill();
    this.client = undefined;
    this.startPromise = undefined;
    this.ready = false;
    this.exitEmitted = false;
  }

  private emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }

  private emitExit(code: number): void {
    if (this.exitEmitted) return;
    this.exitEmitted = true;
    for (const handler of this.exitHandlers) handler(code);
  }
}

function stripTrailingBlankLines(data: string): string {
  const lines = data.split('\n');
  while (lines.length > 0 && lines.at(-1)?.trimEnd() === '') lines.pop();
  if (lines.length === 0) return '';
  // No trailing newline: capture-pane fills the pane height with blank rows
  // below the prompt, so the raw capture ends in '\n'. Re-appending it would
  // leave xterm's cursor on the empty line *below* the prompt (the "cursor
  // below the glyph" seed artifact). The seed must end exactly at the last
  // content line so the cursor lands on the prompt, matching the live shell.
  return lines.join('\n');
}

function normalizeSeedNewlines(data: string): string {
  return data.replace(/\r?\n/g, '\r\n');
}
