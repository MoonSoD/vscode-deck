import { describe, expect, it } from 'vitest';
import { deckSocketPath, isWedged, WedgeRecovery } from '../src/terminal/deckSocketRecovery';

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
    const calls: string[] = [];
    const recovery = new WedgeRecovery({
      isServerRunning: async () => {
        calls.push('isServerRunning');
        return true;
      },
      startServer: async () => {
        calls.push('startServer');
      },
      socketPath: () => '/tmp/tmux-1000/deck',
      socketExists: async (path) => {
        calls.push(`socketExists:${path}`);
        return true;
      },
      removeSocket: async (path) => {
        calls.push(`removeSocket:${path}`);
      },
    });

    await expect(recovery.ensureHealthyServer()).resolves.toEqual({
      recovered: false,
      started: false,
    });

    expect(calls).toEqual(['isServerRunning']);
  });

  it('starts a fresh server without resetting the socket on a clean cold start', async () => {
    const calls: string[] = [];
    const recovery = new WedgeRecovery({
      isServerRunning: async () => {
        calls.push('isServerRunning');
        return false;
      },
      startServer: async () => {
        calls.push('startServer');
      },
      socketPath: () => '/tmp/tmux-1000/deck',
      socketExists: async (path) => {
        calls.push(`socketExists:${path}`);
        return false;
      },
      removeSocket: async (path) => {
        calls.push(`removeSocket:${path}`);
      },
    });

    await expect(recovery.ensureHealthyServer()).resolves.toEqual({
      recovered: false,
      started: true,
    });

    expect(calls).toEqual(['isServerRunning', 'startServer']);
  });

  it('removes the socket and retries start after a confirmed wedge', async () => {
    const calls: string[] = [];
    let startAttempts = 0;
    const recovery = new WedgeRecovery({
      isServerRunning: async () => {
        calls.push('isServerRunning');
        return false;
      },
      startServer: async () => {
        calls.push('startServer');
        startAttempts += 1;
        if (startAttempts === 1) throw new Error('server exited unexpectedly');
      },
      socketPath: () => '/tmp/tmux-1000/deck',
      socketExists: async (path) => {
        calls.push(`socketExists:${path}`);
        return true;
      },
      removeSocket: async (path) => {
        calls.push(`removeSocket:${path}`);
      },
    });

    await expect(recovery.ensureHealthyServer()).resolves.toEqual({
      recovered: true,
      started: true,
    });

    expect(calls).toEqual([
      'isServerRunning',
      'startServer',
      'socketExists:/tmp/tmux-1000/deck',
      'socketExists:/tmp/tmux-1000/deck',
      'isServerRunning',
      'socketExists:/tmp/tmux-1000/deck',
      'isServerRunning',
      'socketExists:/tmp/tmux-1000/deck',
      'isServerRunning',
      'removeSocket:/tmp/tmux-1000/deck',
      'startServer',
    ]);
  });

  it('does not remove the socket when a confirmation probe succeeds', async () => {
    const calls: string[] = [];
    const probes = [false, true];
    const recovery = new WedgeRecovery({
      isServerRunning: async () => {
        calls.push('isServerRunning');
        return probes.shift() ?? false;
      },
      startServer: async () => {
        calls.push('startServer');
        throw new Error('server exited unexpectedly');
      },
      socketPath: () => '/tmp/tmux-1000/deck',
      socketExists: async (path) => {
        calls.push(`socketExists:${path}`);
        return true;
      },
      removeSocket: async (path) => {
        calls.push(`removeSocket:${path}`);
      },
    });

    await expect(recovery.ensureHealthyServer()).resolves.toEqual({
      recovered: false,
      started: false,
    });

    expect(calls).toEqual([
      'isServerRunning',
      'startServer',
      'socketExists:/tmp/tmux-1000/deck',
      'socketExists:/tmp/tmux-1000/deck',
      'isServerRunning',
    ]);
  });

  it('does not remove the socket when it disappears during confirmation', async () => {
    const calls: string[] = [];
    const socketExists = [true, true, false];
    const recovery = new WedgeRecovery({
      isServerRunning: async () => {
        calls.push('isServerRunning');
        return false;
      },
      startServer: async () => {
        calls.push('startServer');
        throw new Error('server exited unexpectedly');
      },
      socketPath: () => '/tmp/tmux-1000/deck',
      socketExists: async (path) => {
        calls.push(`socketExists:${path}`);
        return socketExists.shift() ?? false;
      },
      removeSocket: async (path) => {
        calls.push(`removeSocket:${path}`);
      },
    });

    await expect(recovery.ensureHealthyServer()).resolves.toEqual({
      recovered: false,
      started: false,
    });

    expect(calls).toEqual([
      'isServerRunning',
      'startServer',
      'socketExists:/tmp/tmux-1000/deck',
      'socketExists:/tmp/tmux-1000/deck',
      'isServerRunning',
      'socketExists:/tmp/tmux-1000/deck',
    ]);
  });
});
