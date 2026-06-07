import * as nodePty from 'node-pty';

export interface PtyLike {
  onData(listener: (data: string) => void): { dispose(): void };
  onExit(listener: (event: { exitCode: number }) => void): { dispose(): void };
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

export interface PtyFactory {
  spawn(
    file: string,
    args: string[],
    options: { cols: number; rows: number; cwd: string; name: string },
  ): PtyLike;
}

const nodePtyFactory: PtyFactory = {
  spawn: (file, args, options) => nodePty.spawn(file, args, options),
};

export class TerminalPtyBridge {
  private pty: PtyLike | undefined;
  private pendingSize: { cols: number; rows: number } | undefined;
  private readonly dataHandlers = new Set<(data: string) => void>();
  private readonly exitHandlers = new Set<(code: number) => void>();
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(
    private readonly configPath: string,
    private readonly factory: PtyFactory = nodePtyFactory,
  ) {}

  start(sessionName: string, cwd: string, cols: number, rows: number): void {
    if (this.pty) return;
    const size = this.pendingSize ?? { cols, rows };
    this.pendingSize = undefined;

    this.pty = this.factory.spawn('tmux', [
      '-L',
      'deck',
      '-f',
      this.configPath,
      'new-session',
      '-A',
      '-s',
      sessionName,
      '-c',
      cwd,
    ], {
      cols: size.cols,
      rows: size.rows,
      cwd,
      name: 'xterm-256color',
    });

    this.disposables.push(
      this.pty.onData((data) => {
        for (const handler of this.dataHandlers) handler(data);
      }),
      this.pty.onExit((event) => {
        for (const handler of this.exitHandlers) handler(event.exitCode);
      }),
    );
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
    this.pty?.write(data);
  }

  resize(cols: number, rows: number): void {
    if (!this.pty) {
      this.pendingSize = { cols, rows };
      return;
    }

    this.pty.resize(cols, rows);
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) disposable.dispose();
    this.pty?.kill();
    this.pty = undefined;
  }
}
