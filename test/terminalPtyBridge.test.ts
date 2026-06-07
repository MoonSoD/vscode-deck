import { describe, expect, it, vi } from 'vitest';
import { TerminalPtyBridge, type PtyFactory } from '../src/terminal/terminalPtyBridge';

describe('TerminalPtyBridge', () => {
  it('starts tmux on the Deck socket with create-or-attach args', () => {
    const pty = fakePty();
    const factory: PtyFactory = {
      spawn: vi.fn(() => pty),
    };
    const bridge = new TerminalPtyBridge('/ext/resources/deck.conf', factory);

    bridge.start('wt-_work_repo__term-1', '/work/repo', 120, 32);

    expect(factory.spawn).toHaveBeenCalledWith('tmux', [
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
    ], {
      cols: 120,
      rows: 32,
      cwd: '/work/repo',
      name: 'xterm-256color',
    });
  });

  it('forwards pty data, writes, resize, and exit events', () => {
    const pty = fakePty();
    const bridge = new TerminalPtyBridge('/ext/resources/deck.conf', {
      spawn: vi.fn(() => pty),
    });
    const data = vi.fn();
    const exit = vi.fn();

    bridge.onData(data);
    bridge.onExit(exit);
    bridge.start('wt-_work_repo__term-1', '/work/repo', 80, 24);

    pty.emitData('hello');
    bridge.write('ls\n');
    bridge.resize(100, 40);
    pty.emitExit(7);

    expect(data).toHaveBeenCalledWith('hello');
    expect(pty.write).toHaveBeenCalledWith('ls\n');
    expect(pty.resize).toHaveBeenCalledWith(100, 40);
    expect(exit).toHaveBeenCalledWith(7);
  });

  it('uses the latest resize as the initial pty size when resize arrives before start', () => {
    const pty = fakePty();
    const factory: PtyFactory = {
      spawn: vi.fn(() => pty),
    };
    const bridge = new TerminalPtyBridge('/ext/resources/deck.conf', factory);

    bridge.resize(132, 41);
    bridge.start('wt-_work_repo__term-1', '/work/repo', 80, 24);

    expect(factory.spawn).toHaveBeenCalledWith(
      'tmux',
      expect.any(Array),
      expect.objectContaining({ cols: 132, rows: 41 }),
    );
  });
});

function fakePty() {
  let dataHandler: ((data: string) => void) | undefined;
  let exitHandler: ((event: { exitCode: number }) => void) | undefined;
  return {
    onData: vi.fn((handler: (data: string) => void) => {
      dataHandler = handler;
      return { dispose: vi.fn() };
    }),
    onExit: vi.fn((handler: (event: { exitCode: number }) => void) => {
      exitHandler = handler;
      return { dispose: vi.fn() };
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    emitData: (data: string) => dataHandler?.(data),
    emitExit: (exitCode: number) => exitHandler?.({ exitCode }),
  };
}
