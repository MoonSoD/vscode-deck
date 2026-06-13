import { afterEach, describe, expect, it, vi } from 'vitest';
import { deckSocketPath, isWedged, WedgeRecovery } from '../src/terminal/deckSocketRecovery';
import {
  RECOVERY_LOCK_FILENAME,
  SNAPSHOT_LOCK_FILENAME,
  RecoveryLock,
} from '../src/terminal/recoveryLock';

const SOCKET_PATH = '/tmp/tmux-1000/deck';

afterEach(() => {
  vi.useRealTimers();
});

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

describe('RecoveryLock', () => {
  it('acquires the lock when no peer holds it', async () => {
    const fs = new FakeRecoveryLockFs(() => 1_000);
    const lock = new RecoveryLock({
      deckDir: '/deck',
      fs,
      clock: fakeClock(1_000),
      isHealthy: async () => true,
    });

    await expect(lock.acquire()).resolves.toBe(true);
  });

  it('can acquire the snapshot lock in a separate file', async () => {
    const fs = new FakeRecoveryLockFs(() => 1_000);
    const lock = new RecoveryLock({
      deckDir: '/deck',
      lockFilename: SNAPSHOT_LOCK_FILENAME,
      fs,
      clock: fakeClock(1_000),
      isHealthy: async () => true,
    });

    await expect(lock.acquire()).resolves.toBe(true);

    expect(fs.files.has(`/deck/${SNAPSHOT_LOCK_FILENAME}`)).toBe(true);
    expect(fs.files.has(`/deck/${RECOVERY_LOCK_FILENAME}`)).toBe(false);
  });

  it('does not acquire the snapshot lock while a peer holds it', async () => {
    const fs = new FakeRecoveryLockFs(() => 1_000);
    const first = new RecoveryLock({
      deckDir: '/deck',
      lockFilename: SNAPSHOT_LOCK_FILENAME,
      fs,
      clock: fakeClock(1_000),
      isHealthy: async () => true,
      processProbe: new FakeProcessProbe({ alive: true, startTime: 'holder' }),
    });
    const second = new RecoveryLock({
      deckDir: '/deck',
      lockFilename: SNAPSHOT_LOCK_FILENAME,
      fs,
      clock: fakeClock(1_000),
      isHealthy: async () => true,
      processProbe: new FakeProcessProbe({ alive: true, startTime: 'holder' }),
    });

    await expect(first.acquire()).resolves.toBe(true);

    await expect(second.acquire()).resolves.toBe(false);
  });

  it('does not acquire the lock while a peer holds it', async () => {
    const fs = new FakeRecoveryLockFs(() => 1_000);
    const first = new RecoveryLock({
      deckDir: '/deck',
      fs,
      clock: fakeClock(1_000),
      isHealthy: async () => true,
    });
    const second = new RecoveryLock({
      deckDir: '/deck',
      fs,
      clock: fakeClock(1_000),
      isHealthy: async () => true,
    });

    await expect(first.acquire()).resolves.toBe(true);
    await expect(second.acquire()).resolves.toBe(false);
  });

  it('blocks until a peer releases the lock', async () => {
    let now = 1_000;
    let wakeSleep!: () => void;
    const fs = new FakeRecoveryLockFs(() => now);
    const clock = {
      now: () => now,
      sleep: (ms: number) =>
        new Promise<void>((resolve) => {
          now += ms;
          wakeSleep = resolve;
        }),
    };
    const first = new RecoveryLock({
      deckDir: '/deck',
      fs,
      clock,
      pollIntervalMs: 100,
      timeoutMs: 1_000,
      isHealthy: async () => true,
      processProbe: new FakeProcessProbe({ alive: true, startTime: 'holder' }),
    });
    const second = new RecoveryLock({
      deckDir: '/deck',
      fs,
      clock,
      pollIntervalMs: 100,
      timeoutMs: 1_000,
      isHealthy: async () => true,
      processProbe: new FakeProcessProbe({ alive: true, startTime: 'holder' }),
    });

    await expect(first.acquire()).resolves.toBe(true);
    const waiting = second.acquireBlocking();
    await new Promise((resolve) => setImmediate(resolve));

    expect(fs.files.has(`/deck/${RECOVERY_LOCK_FILENAME}`)).toBe(true);

    await first.release();
    wakeSleep();

    await expect(waiting).resolves.toBe(true);
  });

  it('takes over a stale lock', async () => {
    let now = 62_000;
    const fs = new FakeRecoveryLockFs(() => now);
    fs.files.set(`/deck/${RECOVERY_LOCK_FILENAME}`, { mtimeMs: 1_000, content: 'stale' });
    const lock = new RecoveryLock({
      deckDir: '/deck',
      fs,
      clock: { now: () => now, sleep: async () => undefined },
      ttlMs: 60_000,
      isHealthy: async () => true,
    });

    await expect(lock.acquire()).resolves.toBe(true);

    expect(fs.files.get(`/deck/${RECOVERY_LOCK_FILENAME}`)?.mtimeMs).toBe(now);
  });

  it('steals a dead holder lock without waiting for TTL', async () => {
    let now = 1_000;
    const fs = new FakeRecoveryLockFs(() => now);
    const clock = {
      now: () => now,
      sleep: async (ms: number) => {
        now += ms;
      },
    };
    const first = new RecoveryLock({
      deckDir: '/deck',
      fs,
      clock,
      isHealthy: async () => true,
      processProbe: new FakeProcessProbe({ alive: true, startTime: 'first' }),
    });
    const second = new RecoveryLock({
      deckDir: '/deck',
      fs,
      clock,
      isHealthy: async () => true,
      processProbe: new FakeProcessProbe({ alive: false, startTime: '' }),
    });

    await expect(first.acquire()).resolves.toBe(true);

    await expect(second.acquireBlocking()).resolves.toBe(true);
    expect(now).toBe(1_000);
  });

  it('steals a lock when the holder PID was reused', async () => {
    const fs = new FakeRecoveryLockFs(() => 1_000);
    fs.files.set(`/deck/${RECOVERY_LOCK_FILENAME}`, {
      mtimeMs: 1_000,
      content: JSON.stringify({ ownerToken: 'stale', pid: 123, startTime: 'old-process' }),
    });
    const lock = new RecoveryLock({
      deckDir: '/deck',
      fs,
      clock: fakeClock(1_000),
      isHealthy: async () => true,
      processProbe: new FakeProcessProbe({ alive: true, startTime: 'new-process' }),
    });

    await expect(lock.acquire()).resolves.toBe(true);
  });

  it('keeps old-format lock files TTL-only', async () => {
    const fs = new FakeRecoveryLockFs(() => 1_000);
    fs.files.set(`/deck/${RECOVERY_LOCK_FILENAME}`, { mtimeMs: 1_000, content: 'old-owner-token' });
    const lock = new RecoveryLock({
      deckDir: '/deck',
      fs,
      clock: fakeClock(1_000),
      ttlMs: 60_000,
      isHealthy: async () => true,
      processProbe: new FakeProcessProbe({ alive: false, startTime: '' }),
    });

    await expect(lock.acquire()).resolves.toBe(false);
  });

  it('does not release a stale lock taken over by a peer', async () => {
    let now = 1_000;
    const fs = new FakeRecoveryLockFs(() => now);
    const first = new RecoveryLock({
      deckDir: '/deck',
      fs,
      clock: { now: () => now, sleep: async () => undefined },
      ttlMs: 60_000,
      isHealthy: async () => true,
    });
    const second = new RecoveryLock({
      deckDir: '/deck',
      fs,
      clock: { now: () => now, sleep: async () => undefined },
      ttlMs: 60_000,
      isHealthy: async () => true,
    });

    await expect(first.acquire()).resolves.toBe(true);
    now = 62_000;
    await expect(second.acquire()).resolves.toBe(true);

    await first.release();

    expect(fs.files.has(`/deck/${RECOVERY_LOCK_FILENAME}`)).toBe(true);

    await second.release();

    expect(fs.files.has(`/deck/${RECOVERY_LOCK_FILENAME}`)).toBe(false);
  });

  it('waits until the server becomes healthy', async () => {
    vi.useFakeTimers();
    let healthy = false;
    const lock = new RecoveryLock({
      deckDir: '/deck',
      fs: new FakeRecoveryLockFs(() => Date.now()),
      clock: timerClock(),
      pollIntervalMs: 100,
      timeoutMs: 1_000,
      isHealthy: async () => healthy,
    });

    const waiting = lock.waitForHealthy();
    await Promise.resolve();
    healthy = true;
    await vi.advanceTimersByTimeAsync(100);

    await expect(waiting).resolves.toBeUndefined();
  });

  it('times out when the server never becomes healthy', async () => {
    vi.useFakeTimers();
    const lock = new RecoveryLock({
      deckDir: '/deck',
      fs: new FakeRecoveryLockFs(() => Date.now()),
      clock: timerClock(),
      pollIntervalMs: 100,
      timeoutMs: 300,
      isHealthy: async () => false,
    });

    const waiting = lock.waitForHealthy();
    const assertion = expect(waiting).rejects.toThrow('Timed out waiting for DeckSocket recovery');
    await vi.advanceTimersByTimeAsync(300);

    await assertion;
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

    expect(harness.serverChecks).toBe(7);
    expect(harness.startAttempts).toBe(2);
    expect(harness.socketChecks).toBe(7);
    expect(harness.lockCalls).toEqual(['acquire', 'release']);
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

  it('waits for a peer recovery instead of resetting when the lock is held', async () => {
    const harness = createRecoveryHarness({
      serverRunning: [false, false, false, false],
      startErrors: [new Error('server exited unexpectedly')],
      lockAcquired: false,
    });

    await expect(harness.recovery.ensureHealthyServer()).resolves.toEqual({
      recovered: false,
      started: false,
    });

    expect(harness.startAttempts).toBe(1);
    expect(harness.lockCalls).toEqual(['acquire', 'waitForHealthy']);
    expect(harness.removedSockets).toEqual([]);
  });

  it('aborts under the lock when a peer already made the server healthy', async () => {
    const harness = createRecoveryHarness({
      serverRunning: [false, false, false, false, true],
      startErrors: [new Error('server exited unexpectedly')],
    });

    await expect(harness.recovery.ensureHealthyServer()).resolves.toEqual({
      recovered: false,
      started: false,
    });

    expect(harness.lockCalls).toEqual(['acquire', 'release']);
    expect(harness.removedSockets).toEqual([]);
  });

  it('releases the lock when recovery fails after removing the socket', async () => {
    const harness = createRecoveryHarness({
      serverRunning: [false, false, false, false, false, false, false],
      startErrors: [
        new Error('server exited unexpectedly'),
        new Error('fresh server failed'),
      ],
    });

    await expect(harness.recovery.ensureHealthyServer()).rejects.toThrow('fresh server failed');

    expect(harness.removedSockets).toEqual([SOCKET_PATH]);
    expect(harness.lockCalls).toEqual(['acquire', 'release']);
  });
});

function createRecoveryHarness(options: {
  serverRunning: boolean[];
  socketExists?: boolean[];
  startErrors?: Error[];
  lockAcquired?: boolean;
}) {
  const serverRunning = [...options.serverRunning];
  const socketExists = [...(options.socketExists ?? [true])];
  const socketExistsFallback = socketExists.at(-1) ?? false;
  const startErrors = [...(options.startErrors ?? [])];
  const removedSockets: string[] = [];
  let serverChecks = 0;
  let socketChecks = 0;
  let startAttempts = 0;
  const lockCalls: string[] = [];

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
    recoveryLock: {
      acquire: async () => {
        lockCalls.push('acquire');
        return options.lockAcquired ?? true;
      },
      release: async () => {
        lockCalls.push('release');
      },
      waitForHealthy: async () => {
        lockCalls.push('waitForHealthy');
      },
    },
    sleep: async () => undefined,
  });

  return {
    recovery,
    removedSockets,
    lockCalls,
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

class FakeRecoveryLockFs {
  readonly files = new Map<string, { mtimeMs: number; content: string }>();

  constructor(private readonly now: () => number) {}

  async mkdir(_path: string, _options: { recursive: true }): Promise<void> {}

  async open(path: string, _flags: number): Promise<{
    writeFile(data: string): Promise<void>;
    close(): Promise<void>;
  }> {
    if (this.files.has(path)) throw errorWithCode('EEXIST');
    this.files.set(path, { mtimeMs: this.now(), content: '' });
    return {
      writeFile: async (data) => {
        this.files.set(path, { mtimeMs: this.now(), content: data });
      },
      close: async () => undefined,
    };
  }

  async readFile(path: string, _encoding: 'utf8'): Promise<string> {
    const file = this.files.get(path);
    if (!file) throw errorWithCode('ENOENT');
    return file.content;
  }

  async stat(path: string): Promise<{ mtimeMs: number }> {
    const file = this.files.get(path);
    if (!file) throw errorWithCode('ENOENT');
    return file;
  }

  async rm(path: string, _options: { force: true }): Promise<void> {
    this.files.delete(path);
  }
}

function fakeClock(now: number) {
  return {
    now: () => now,
    sleep: async () => undefined,
  };
}

function timerClock() {
  return {
    now: () => Date.now(),
    sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  };
}

function errorWithCode(code: string): Error {
  const error = new Error(code) as Error & { code: string };
  error.code = code;
  return error;
}

class FakeProcessProbe {
  constructor(private readonly process: { alive: boolean; startTime: string }) {}

  async isAlive(_pid: number): Promise<boolean> {
    return this.process.alive;
  }

  async startTime(_pid: number): Promise<string> {
    return this.process.startTime;
  }
}
