import { TmuxControlClient } from './tmuxControlClient';

export interface TmuxControlClientLike {
  start(sessionName: string, cwd: string): Promise<void> | void;
  onOutput(handler: (data: string) => void): { dispose(): void };
  onExit(handler: (code: number | null) => void): { dispose(): void };
  sendKeys(data: string): Promise<void> | void;
  resize(cols: number, rows: number): Promise<void> | void;
  capturePane(lines: number): Promise<string> | string;
  kill(): void;
}

export type TmuxControlClientFactory = (configPath: string) => TmuxControlClientLike;

const defaultClientFactory: TmuxControlClientFactory = (configPath) =>
  new TmuxControlClient(configPath);

export class TerminalTransport {
  private client: TmuxControlClientLike | undefined;
  private startPromise: Promise<void> | undefined;
  private started = false;
  private pendingSize: { cols: number; rows: number } | undefined;
  private readonly dataHandlers = new Set<(data: string) => void>();
  private readonly exitHandlers = new Set<(code: number) => void>();
  private readonly disposables: Array<{ dispose(): void }> = [];
  private readonly pendingOutput: string[] = [];

  constructor(
    private readonly configPath: string,
    private readonly clientFactory: TmuxControlClientFactory = defaultClientFactory,
  ) {}

  start(sessionName: string, cwd: string, cols: number, rows: number): void {
    if (this.client) return;
    const size = this.pendingSize ?? { cols, rows };
    this.pendingSize = undefined;

    this.client = this.clientFactory(this.configPath);
    const client = this.client;
    this.disposables.push(
      client.onOutput((data) => {
        if (!this.started) {
          this.pendingOutput.push(data);
          return;
        }
        this.emitData(data);
      }),
      client.onExit((code) => {
        for (const handler of this.exitHandlers) handler(code ?? 0);
      }),
    );

    const started = client.start(sessionName, cwd);
    this.startPromise = this.seedAfterStart(client, started);
    void client.resize(size.cols, size.rows);
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
    if (this.started) {
      void client.sendKeys(data);
      return;
    }

    void this.startPromise?.then(() => {
      if (this.client === client) void client.sendKeys(data);
    });
  }

  resize(cols: number, rows: number): void {
    if (!this.client) {
      this.pendingSize = { cols, rows };
      return;
    }

    void this.client.resize(cols, rows);
  }

  dispose(): void {
    this.kill();
  }

  kill(): void {
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.client?.kill();
    this.client = undefined;
    this.startPromise = undefined;
    this.started = false;
    this.pendingOutput.length = 0;
  }

  private seedAfterStart(client: TmuxControlClientLike, started: Promise<void> | void): Promise<void> {
    const seed = () => {
      if (this.client !== client) return;
      const captured = client.capturePane(5000);
      if (isPromiseLike(captured)) return captured.then((data) => this.finishSeed(client, data));
      this.finishSeed(client, captured);
    };

    if (isPromiseLike(started)) return started.then(seed);
    const seeded = seed();
    return isPromiseLike(seeded) ? seeded : Promise.resolve();
  }

  private finishSeed(client: TmuxControlClientLike, seed: string): void {
    if (this.client !== client) return;
    const scrollback = normalizeSeedNewlines(stripTrailingBlankLines(seed));
    if (scrollback) this.emitData(scrollback);
    for (const data of this.pendingOutput.splice(0)) this.emitData(data);
    this.started = true;
  }

  private emitData(data: string): void {
    for (const handler of this.dataHandlers) handler(data);
  }
}

function stripTrailingBlankLines(data: string): string {
  const lines = data.split('\n');
  while (lines.length > 0 && lines.at(-1)?.trimEnd() === '') lines.pop();
  if (lines.length === 0) return '';
  return lines.join('\n') + (data.endsWith('\n') ? '\n' : '');
}

function normalizeSeedNewlines(data: string): string {
  return data.replace(/\r?\n/g, '\r\n');
}

function isPromiseLike<T>(value: Promise<T> | T): value is Promise<T> {
  return typeof value === 'object' && value !== null && 'then' in value;
}
