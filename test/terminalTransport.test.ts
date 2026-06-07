import { describe, expect, it, vi } from 'vitest';
import { TerminalTransport, type TmuxControlClientFactory } from '../src/terminal/terminalTransport';

describe('TerminalTransport', () => {
  it('starts a tmux control client and applies the initial size', () => {
    const client = fakeClient();
    const factory: TmuxControlClientFactory = vi.fn(() => client);
    const transport = new TerminalTransport('/ext/resources/deck.conf', factory);

    transport.start('wt-_work_repo__term-1', '/work/repo', 120, 32);

    expect(factory).toHaveBeenCalledWith('/ext/resources/deck.conf');
    expect(client.start).toHaveBeenCalledWith('wt-_work_repo__term-1', '/work/repo');
    expect(client.resize).toHaveBeenCalledWith(120, 32);
  });

  it('forwards control output, writes, resize, exit events, and dispose', () => {
    const client = fakeClient();
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    const data = vi.fn();
    const exit = vi.fn();

    transport.onData(data);
    transport.onExit(exit);
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);

    client.emitOutput('hello');
    transport.write('ls\n');
    transport.resize(100, 40);
    client.emitExit(7);
    transport.dispose();

    expect(data).toHaveBeenCalledWith('hello');
    expect(client.sendKeys).toHaveBeenCalledWith('ls\n');
    expect(client.resize).toHaveBeenLastCalledWith(100, 40);
    expect(exit).toHaveBeenCalledWith(7);
    expect(client.kill).toHaveBeenCalledOnce();
  });

  it('seeds scrollback from tmux history before forwarding live output', async () => {
    let resolveCapture: ((data: string) => void) | undefined;
    const client = fakeClient();
    client.capturePane.mockReturnValue(new Promise<string>((resolve) => {
      resolveCapture = resolve;
    }));
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    const data = vi.fn();

    transport.onData(data);
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    client.emitOutput('live\r\n');

    expect(data).not.toHaveBeenCalled();

    resolveCapture?.('seed\r\n');
    await Promise.resolve();
    await Promise.resolve();

    expect(client.capturePane).toHaveBeenCalledWith(5000);
    expect(data.mock.calls.map(([payload]) => payload)).toEqual(['seed\r\n', 'live\r\n']);
  });

  it('drops trailing blank screen lines from the seeded scrollback', () => {
    const client = fakeClient();
    client.capturePane.mockReturnValue('prompt\r\n\r\n   \n');
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    const data = vi.fn();

    transport.onData(data);
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);

    expect(data).toHaveBeenCalledWith('prompt\r\n');
  });

  it('normalizes captured line feeds for xterm replay', () => {
    const client = fakeClient();
    client.capturePane.mockReturnValue('one\ntwo');
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));
    const data = vi.fn();

    transport.onData(data);
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);

    expect(data).toHaveBeenCalledWith('one\r\ntwo');
  });

  it('uses the latest resize as the initial control-client size when resize arrives before start', () => {
    const client = fakeClient();
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));

    transport.resize(100, 30);
    transport.resize(132, 41);
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);

    expect(client.resize).toHaveBeenCalledTimes(1);
    expect(client.resize).toHaveBeenCalledWith(132, 41);
  });

  it('waits for startup before forwarding writes to the control client', async () => {
    let resolveStart: (() => void) | undefined;
    const client = fakeClient();
    client.start.mockReturnValue(new Promise<void>((resolve) => {
      resolveStart = resolve;
    }));
    const transport = new TerminalTransport('/ext/resources/deck.conf', vi.fn(() => client));

    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    transport.write('echo ok\n');

    expect(client.sendKeys).not.toHaveBeenCalled();

    resolveStart?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(client.sendKeys).toHaveBeenCalledWith('echo ok\n');
  });

  it('does not let a stale startup mark a restarted client as ready', async () => {
    let resolveFirstStart: (() => void) | undefined;
    let resolveSecondStart: (() => void) | undefined;
    const firstClient = fakeClient();
    const secondClient = fakeClient();
    firstClient.start.mockReturnValue(new Promise<void>((resolve) => {
      resolveFirstStart = resolve;
    }));
    secondClient.start.mockReturnValue(new Promise<void>((resolve) => {
      resolveSecondStart = resolve;
    }));
    const transport = new TerminalTransport(
      '/ext/resources/deck.conf',
      vi.fn()
        .mockReturnValueOnce(firstClient)
        .mockReturnValueOnce(secondClient),
    );

    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    transport.kill();
    transport.start('wt-_work_repo__term-1', '/work/repo', 80, 24);
    resolveFirstStart?.();
    await Promise.resolve();
    transport.write('echo ok\n');

    expect(secondClient.sendKeys).not.toHaveBeenCalled();

    resolveSecondStart?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(secondClient.sendKeys).toHaveBeenCalledWith('echo ok\n');
  });
});

function fakeClient() {
  let outputHandler: ((data: string) => void) | undefined;
  let exitHandler: ((code: number | null) => void) | undefined;
  return {
    start: vi.fn(),
    sendKeys: vi.fn(),
    resize: vi.fn(),
    capturePane: vi.fn(() => ''),
    onOutput: vi.fn((handler: (data: string) => void) => {
      outputHandler = handler;
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn((handler: (code: number | null) => void) => {
      exitHandler = handler;
      return { dispose: vi.fn() };
    }),
    kill: vi.fn(),
    emitOutput: (data: string) => outputHandler?.(data),
    emitExit: (code: number | null) => exitHandler?.(code),
  };
}
