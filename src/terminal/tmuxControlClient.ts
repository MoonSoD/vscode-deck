import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import { TextDecoder } from 'node:util';

export interface TmuxControlChild {
  stdout: Readable;
  stdin: Writable;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  kill(): void;
}

export type TmuxControlSpawnFactory = (
  file: string,
  args: string[],
  options: { cwd: string; stdio: 'pipe' },
) => TmuxControlChild;

const defaultSpawn: TmuxControlSpawnFactory = (file, args, options) =>
  spawn(file, args, options) as TmuxControlChild;

interface PendingReply {
  resolve(body: string): void;
  reject(error: Error): void;
}

export class TmuxControlClient {
  private child: TmuxControlChild | undefined;
  private startPromise: Promise<void> | undefined;
  private lineBuffer = Buffer.alloc(0);
  private paneId: string | undefined;
  private activeReply: { body: string[] } | undefined;
  private readonly pendingReplies: PendingReply[] = [];
  private readonly outputHandlers = new Set<(data: string) => void>();
  private readonly exitHandlers = new Set<(code: number | null) => void>();
  private readonly paneDecoder = new TextDecoder();
  private exitFired = false;

  constructor(
    private readonly configPath: string,
    private readonly spawnFactory: TmuxControlSpawnFactory = defaultSpawn,
  ) {}

  start(sessionName: string, cwd: string): Promise<void> {
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.startControlClient(sessionName, cwd);
    return this.startPromise;
  }

  private async startControlClient(sessionName: string, cwd: string): Promise<void> {
    const attach = this.enqueueReply();
    this.child = this.spawnFactory('tmux', [
      '-C',
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
    ], { cwd, stdio: 'pipe' });

    this.child.stdout.on('data', (chunk: Buffer) => this.acceptStdout(chunk));
    this.child.on('exit', (code) => this.fireExit(code));

    await attach;
    const panes = (await this.command(`list-panes -s -t =${sessionName} -F "#{pane_id}"`))
      .trim()
      .split('\n')
      .filter(Boolean);
    if (panes.length !== 1) {
      throw new Error(`expected exactly one tmux pane, got ${panes.length}`);
    }
    this.paneId = panes[0];
  }

  onOutput(handler: (data: string) => void): { dispose(): void } {
    this.outputHandlers.add(handler);
    return { dispose: () => this.outputHandlers.delete(handler) };
  }

  onExit(handler: (code: number | null) => void): { dispose(): void } {
    this.exitHandlers.add(handler);
    return { dispose: () => this.exitHandlers.delete(handler) };
  }

  async sendKeys(data: string): Promise<void> {
    if (!this.paneId) throw new Error('tmux control client has not started');
    const bytes = Buffer.from(data, 'utf8');
    if (bytes.length === 0) return;
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      const chunk = bytes.subarray(offset, offset + 4096);
      const hexBytes = Array.from(chunk, (byte) => byte.toString(16).padStart(2, '0'));
      await this.command(`send-keys -t ${this.paneId} -H ${hexBytes.join(' ')}`);
    }
  }

  async resize(cols: number, rows: number): Promise<void> {
    await this.command(`refresh-client -C ${cols}x${rows}`);
  }

  async capturePane(lines: number): Promise<string> {
    return this.command(`capture-pane -p -e -J -S -${lines}`);
  }

  kill(): void {
    this.child?.kill();
  }

  private command(command: string): Promise<string> {
    if (!this.child) throw new Error('tmux control client has not started');
    const reply = this.enqueueReply();
    this.child.stdin.write(`${command}\n`);
    return reply;
  }

  private enqueueReply(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pendingReplies.push({ resolve, reject });
    });
  }

  private acceptStdout(chunk: Buffer): void {
    this.lineBuffer = Buffer.concat([this.lineBuffer, chunk]);

    for (;;) {
      const newline = this.lineBuffer.indexOf(0x0a);
      if (newline === -1) return;

      const line = this.lineBuffer.subarray(0, newline);
      this.lineBuffer = this.lineBuffer.subarray(newline + 1);
      this.acceptLine(line);
    }
  }

  private acceptLine(line: Buffer): void {
    const text = line.toString('utf8');
    if (text.startsWith('%begin ')) {
      this.activeReply = { body: [] };
      return;
    }

    if (text.startsWith('%end ')) {
      const reply = this.pendingReplies.shift();
      const body = this.activeReply?.body.join('\n') ?? '';
      this.activeReply = undefined;
      reply?.resolve(body);
      return;
    }

    if (text.startsWith('%error ')) {
      const reply = this.pendingReplies.shift();
      const message = this.activeReply?.body.join('\n') || 'tmux command failed';
      this.activeReply = undefined;
      reply?.reject(new Error(message));
      return;
    }

    if (text.startsWith('%output ')) {
      this.acceptOutput(line);
      return;
    }

    if (text.startsWith('%exit')) return;

    if (this.activeReply) {
      this.activeReply.body.push(text);
    }
  }

  private acceptOutput(line: Buffer): void {
    const firstSpace = line.indexOf(0x20);
    const secondSpace = line.indexOf(0x20, firstSpace + 1);
    if (secondSpace === -1) return;

    const payload = line.subarray(secondSpace + 1);
    const bytes = decodeOctalEscapes(payload);
    const output = this.paneDecoder.decode(bytes, { stream: true });
    if (output.length === 0) return;
    for (const handler of this.outputHandlers) handler(output);
  }

  private fireExit(code: number | null): void {
    if (this.exitFired) return;
    this.exitFired = true;
    for (const handler of this.exitHandlers) handler(code);
  }
}

function decodeOctalEscapes(input: Buffer): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i += 1) {
    if (
      input[i] === 0x5c &&
      i + 3 < input.length &&
      isOctal(input[i + 1]) &&
      isOctal(input[i + 2]) &&
      isOctal(input[i + 3])
    ) {
      bytes.push(Number.parseInt(input.subarray(i + 1, i + 4).toString('ascii'), 8));
      i += 3;
      continue;
    }
    bytes.push(input[i]);
  }
  return Buffer.from(bytes);
}

function isOctal(byte: number): boolean {
  return byte >= 0x30 && byte <= 0x37;
}
