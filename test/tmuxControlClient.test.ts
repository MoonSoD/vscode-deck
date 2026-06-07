import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { PassThrough, Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { TmuxControlClient, type TmuxControlSpawnFactory } from '../src/terminal/tmuxControlClient';

describe('TmuxControlClient', () => {
  it('starts tmux control mode and discovers the single pane', async () => {
    const child = fakeChild();
    const spawn: TmuxControlSpawnFactory = vi.fn(() => child);
    const client = new TmuxControlClient('/ext/resources/deck.conf', spawn);

    const started = client.start('wt-_work_repo__term-1', '/work/repo');

    child.emitStdout('%begin 1 1 0\n%end 1 1 0\n');
    await untilWrites(child, 1);
    child.emitStdout('%begin 1 2 1\n%0\n%end 1 2 1\n');
    await started;

    expect(spawn).toHaveBeenCalledWith('tmux', [
      '-C',
      '-L',
      'deck',
      '-f',
      '/ext/resources/deck.conf',
      'new-session',
      '-A',
      '-s',
      'wt-_work_repo__term-1',
      '-c',
      '/work/repo',
    ], { cwd: '/work/repo', stdio: 'pipe' });
    expect(child.writes).toEqual(['list-panes -s -t =wt-_work_repo__term-1 -F "#{pane_id}"\n']);
  });

  it('decodes pane output escapes after reassembling UTF-8 across output events', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    const output = vi.fn();

    client.onOutput(output);
    const started = client.start('wt-_work_repo__term-1', '/work/repo');
    child.emitStdout('%begin 1 1 0\n%end 1 1 0\n');
    await untilWrites(child, 1);
    child.emitStdout('%begin 1 2 1\n%0\n%end 1 2 1\n');
    await started;

    child.emitStdout(Buffer.concat([
      Buffer.from('%output %0 hello\\015\\012slash=\\134 title=\\033kseq\\033\\134 ', 'utf8'),
      Buffer.from([0xc3]),
      Buffer.from('\n%output %0 ', 'utf8'),
      Buffer.from([0xa9]),
      Buffer.from('\n', 'utf8'),
    ]));

    expect(output.mock.calls.map(([data]) => data).join('')).toBe(
      'hello\r\nslash=\\ title=\x1bkseq\x1b\\ é',
    );
  });

  it('chunks sendKeys into sequential commands of at most 4096 bytes', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    await startClient(client, child);

    const data = `${'a'.repeat(4096)}é`;
    const sent = client.sendKeys(data);

    await untilWrites(child, 2);
    expect(sendKeysByteLengths(child.writes.slice(1))).toEqual([4096]);

    child.emitStdout('%begin 1 3 1\n%end 1 3 1\n');
    await untilWrites(child, 3);
    expect(sendKeysByteLengths(child.writes.slice(1))).toEqual([4096, 2]);

    child.emitStdout('%begin 1 4 1\n%end 1 4 1\n');
    await sent;
    expect(reassembleSendKeys(child.writes.slice(1))).toEqual(Buffer.from(data, 'utf8'));
  });

  it('correlates command replies FIFO while ignoring notifications', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    await startClient(client, child);

    const resized = client.resize(120, 40);
    const captured = client.capturePane(5);
    await untilWrites(child, 3);

    child.emitStdout('%sessions-changed\n%begin 1 3 1\n%end 1 3 1\n%window-close @1\n');
    await resized;
    child.emitStdout('%begin 1 4 1\nfirst line\nsecond line\n%end 1 4 1\n');

    await expect(captured).resolves.toBe('first line\nsecond line');
    expect(child.writes.slice(1)).toEqual([
      'refresh-client -C 120x40\n',
      'capture-pane -p -e -J -S -5\n',
    ]);
  });

  it('rejects an errored reply with the in-block message', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    await startClient(client, child);

    const captured = client.capturePane(5);
    await untilWrites(child, 2);
    child.emitStdout('%begin 1 3 1\nparse error: yacc stack overflow\n%error 1 3 1\n');

    await expect(captured).rejects.toThrow('parse error: yacc stack overflow');
  });

  it('fires onExit once with the child process exit code', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    const exit = vi.fn();
    client.onExit(exit);
    await startClient(client, child);

    child.emitStdout('%exit\n');
    child.emitExit(7);
    child.emitExit(9);

    expect(exit).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(7);
  });

  it('kills the control client process', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    await startClient(client, child);

    client.kill();

    expect(child.kill).toHaveBeenCalledTimes(1);
  });

  it('replays the recorded control-mode transcript without losing seq output', async () => {
    const child = fakeChild();
    const client = new TmuxControlClient('/ext/resources/deck.conf', vi.fn(() => child));
    let output = '';
    client.onOutput((data) => {
      output += data;
    });
    const transcript = readFileSync('prototypes/control-mode/transcript.txt');
    const firstReplyEnd = transcript.indexOf(Buffer.from('%end 1780851797 280 0\n')) +
      Buffer.byteLength('%end 1780851797 280 0\n');

    const started = client.start('wt-_work_repo__term-1', '/work/repo');
    child.emitStdout(transcript.subarray(0, firstReplyEnd));
    await untilWrites(child, 1);
    child.emitStdout(transcript.subarray(firstReplyEnd));
    await started;

    expect(output).toContain('1\r\n2\r\n3\r\n');
    expect(output).toContain('999\r\n1000\r\n');
  });
});

function fakeChild() {
  const events = new EventEmitter();
  const stdout = new PassThrough();
  const writes: string[] = [];
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      writes.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      callback();
    },
  });

  return {
    stdout,
    stdin,
    writes,
    on: events.on.bind(events),
    kill: vi.fn(),
    emitStdout: (data: string | Buffer) => stdout.write(typeof data === 'string' ? Buffer.from(data, 'utf8') : data),
    emitExit: (code: number) => events.emit('exit', code),
  };
}

async function untilWrites(child: { writes: string[] }, count: number): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (child.writes.length >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`expected ${count} writes, got ${child.writes.length}`);
}

async function startClient(client: TmuxControlClient, child: ReturnType<typeof fakeChild>): Promise<void> {
  const started = client.start('wt-_work_repo__term-1', '/work/repo');
  child.emitStdout('%begin 1 1 0\n%end 1 1 0\n');
  await untilWrites(child, 1);
  child.emitStdout('%begin 1 2 1\n%0\n%end 1 2 1\n');
  await started;
}

function sendKeysByteLengths(commands: string[]): number[] {
  return commands.map((command) => sendKeysHex(command).length / 2);
}

function reassembleSendKeys(commands: string[]): Buffer {
  return Buffer.from(commands.map(sendKeysHex).join(''), 'hex');
}

function sendKeysHex(command: string): string {
  const hexArgs = command.trim().split(' ').slice(4);
  return hexArgs.join('');
}
