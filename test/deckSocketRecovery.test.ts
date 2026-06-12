import { describe, expect, it } from 'vitest';
import { deckSocketPath, isWedged, WedgeRecovery } from '../src/terminal/deckSocketRecovery';

const SOCKET_PATH = '/tmp/tmux-1000/deck';

describe('isWedged', () => {
  it.each([
    ['stderr', new Error('server exited unexpectedly')],
    ['stdout', { stdout: 'server exited unexpectedly', stderr: '' }],
  ])('matches %s with the wedge signature', (_name, error) => {
    expect(isWedged(error)).toBe(true);
  });

  it.each([
    ['no server running on /tmp/tmux-1000/deck'],
    ['error connecting to /tmp/tmux-1000/deck (No such file or directory)'],
    ["can't find session: wt-_work_repo__term-1"],
    ['session not found: wt-_work_repo__term-1'],
    ['tmux new-session failed: 1'],
  ])('rejects %s', (message) => {
    expect(isWedged(new Error(message))).toBe(false);
  });
});

describe('deckSocketPath', () => {
  it('resolves the Deck socket the way tmux resolves -L deck', () => {
    expect(deckSocketPath({ env: { TMUX_TMPDIR: '/var/run' }, uid: 501 })).toBe(
      '/var/run/tmux-501/deck',
    );
    expect(deckSocketPath({ env: {}, uid: 1000 })).toBe('/tmp/tmux-1000/deck');
  });
});

describe('WedgeRecovery', () => {
  it('does not start or reset when the server is already healthy', async () => {
    const harness = createRecoveryHarness({ serverRunning: [true] });

    await expect(harness.recovery.ensureHealthyServer()).resolves.toEqual({
      recovered: false,
      started: false,
    });

    expect(harness.serverChecks).toBe(1);
    expect(harness.startAttempts).toBe(0);
    expect(harness.socketChecks).toBe(0);
    expect(harness.removedSockets).toEqual([]);
  });

  it('starts a fresh server without resetting the socket on a clean cold start', async () => {
    const harness = createRecoveryHarness({ serverRunning: [false] });

    await expect(harness.recovery.ensureHealthyServer()).resolves.toEqual({
      recovered: false,
      started: true,
    });

    expect(harness.serverChecks).toBe(1);
    expect(harness.startAttempts).toBe(1);
    expect(harness.socketChecks).toBe(0);
    expect(harness.removedSockets).toEqual([]);
  });

  it('removes the socket and retries start after a confirmed wedge', async () => {
    const harness = createRecoveryHarness({
      serverRunning: [false, false, false, false],
      startErrors: [new Error('server exited unexpectedly')],
    });

    await expect(harness.recovery.ensureHealthyServer()).resolves.toEqual({
      recovered: true,
      started: true,
    });

    expect(harness.serverChecks).toBe(4);
    expect(harness.startAttempts).toBe(2);
    expect(harness.socketChecks).toBe(4);
    expect(harness.removedSockets).toEqual([SOCKET_PATH]);
  });

  it('does not remove the socket when a confirmation probe succeeds', async () => {
    const harness = createRecoveryHarness({
      serverRunning: [false, true],
      startErrors: [new Error('server exited unexpectedly')],
    });

    await expect(harness.recovery.ensureHealthyServer()).resolves.toEqual({
      recovered: false,
      started: false,
    });

    expect(harness.serverChecks).toBe(2);
    expect(harness.startAttempts).toBe(1);
    expect(harness.socketChecks).toBe(2);
    expect(harness.removedSockets).toEqual([]);
  });

  it('does not remove the socket when it disappears during confirmation', async () => {
    const harness = createRecoveryHarness({
      serverRunning: [false, false],
      socketExists: [true, true, false],
      startErrors: [new Error('server exited unexpectedly')],
    });

    await expect(harness.recovery.ensureHealthyServer()).resolves.toEqual({
      recovered: false,
      started: false,
    });

    expect(harness.serverChecks).toBe(2);
    expect(harness.startAttempts).toBe(1);
    expect(harness.socketChecks).toBe(3);
    expect(harness.removedSockets).toEqual([]);
  });
});

function createRecoveryHarness(options: {
  serverRunning: boolean[];
  socketExists?: boolean[];
  startErrors?: Error[];
}) {
  const serverRunning = [...options.serverRunning];
  const socketExists = [...(options.socketExists ?? [true])];
  const socketExistsFallback = socketExists.at(-1) ?? false;
  const startErrors = [...(options.startErrors ?? [])];
  const removedSockets: string[] = [];
  let serverChecks = 0;
  let socketChecks = 0;
  let startAttempts = 0;

  const recovery = new WedgeRecovery({
    isServerRunning: async () => {
      serverChecks += 1;
      return next(serverRunning, false);
    },
    startServer: async () => {
      startAttempts += 1;
      const error = startErrors.shift();
      if (error) throw error;
    },
    socketPath: () => SOCKET_PATH,
    socketExists: async (path) => {
      expect(path).toBe(SOCKET_PATH);
      socketChecks += 1;
      return next(socketExists, socketExistsFallback);
    },
    removeSocket: async (path) => {
      removedSockets.push(path);
    },
  });

  return {
    recovery,
    removedSockets,
    get serverChecks() {
      return serverChecks;
    },
    get socketChecks() {
      return socketChecks;
    },
    get startAttempts() {
      return startAttempts;
    },
  };
}

function next<T>(values: T[], fallback: T): T {
  return values.shift() ?? fallback;
}
