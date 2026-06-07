import { TmuxControlClient } from './tmuxControlClient';

export interface TmuxControlClientLike {
  start(sessionName: string, cwd: string): Promise<void> | void;
  onOutput(handler: (data: string) => void): { dispose(): void };
  onExit(handler: (code: number | null) => void): { dispose(): void };
  sendKeys(data: string): Promise<void> | void;
  resize(cols: number, rows: number): Promise<void> | void;
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
        for (const handler of this.dataHandlers) handler(data);
      }),
      client.onExit((code) => {
        for (const handler of this.exitHandlers) handler(code ?? 0);
      }),
    );

    const started = client.start(sessionName, cwd);
    if (isPromiseLike(started)) {
      this.startPromise = started.then(() => {
        if (this.client === client) this.started = true;
      });
    } else {
      this.started = true;
      this.startPromise = Promise.resolve();
    }
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
  }
}

function isPromiseLike(value: Promise<void> | void): value is Promise<void> {
  return typeof value === 'object' && value !== null && 'then' in value;
}
