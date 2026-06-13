import { afterEach, describe, expect, it, vi } from 'vitest';
import { WedgeRecovery } from '../src/terminal/deckSocketRecovery';
import { TerminalSnapshotRuntime } from '../src/terminal/terminalSnapshotRuntime';

class FakeTmux {
  readonly calls: string[] = [];
  serverRunning = false;
  runShellError: Error | undefined;
  newAnchorErrors: Error[] = [];

  async runShell(scriptPath: string): Promise<void> {
    this.calls.push(`runShell:${scriptPath}`);
    if (this.runShellError) throw this.runShellError;
  }

  async isServerRunning(): Promise<boolean> {
    this.calls.push('isServerRunning');
    return this.serverRunning;
  }

  async newAnchorSession(session: string, cwd: string): Promise<void> {
    this.calls.push(`newAnchorSession:${session}:${cwd}`);
    const error = this.newAnchorErrors.shift();
    if (error) throw error;
  }

  async killSession(session: string): Promise<void> {
    this.calls.push(`killSession:${session}`);
  }
}

class FakeSaveLock {
  releases = 0;

  constructor(private readonly acquired: boolean) {}

  async acquire(): Promise<boolean> {
    return this.acquired;
  }

  async release(): Promise<void> {
    this.releases += 1;
  }
}

class SharedSaveLock {
  releases = 0;
  private held = false;

  async acquire(): Promise<boolean> {
    if (this.held) return false;
    this.held = true;
    return true;
  }

  async release(): Promise<void> {
    this.releases += 1;
    this.held = false;
  }
}

describe('TerminalSnapshotRuntime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves through run-shell with the current save script path', async () => {
    const tmux = new FakeTmux();
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => `/ext/resources/plugins/tmux-resurrect/scripts/save-${tmux.calls.length + 1}.sh`,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
    );

    await runtime.save();
    await runtime.save();

    expect(tmux.calls).toEqual([
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/save-1.sh',
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/save-2.sh',
    ]);
  });

  it('skips save when a peer holds the save lock', async () => {
    const tmux = new FakeTmux();
    const saveLock = new FakeSaveLock(false);
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
      () => Promise.resolve(),
      undefined,
      undefined,
      saveLock,
    );

    await runtime.save();

    expect(tmux.calls).toEqual([]);
    expect(saveLock.releases).toBe(0);
  });

  it('releases the save lock after saving', async () => {
    const tmux = new FakeTmux();
    const saveLock = new FakeSaveLock(true);
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
      () => Promise.resolve(),
      undefined,
      undefined,
      saveLock,
    );

    await runtime.save();

    expect(tmux.calls).toEqual(['runShell:/ext/resources/plugins/tmux-resurrect/scripts/save.sh']);
    expect(saveLock.releases).toBe(1);
  });

  it('runs only one concurrent save across runtimes sharing a save lock', async () => {
    const tmux = new FakeTmux();
    const saveLock = new SharedSaveLock();
    const first = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
      () => Promise.resolve(),
      undefined,
      undefined,
      saveLock,
    );
    const second = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
      () => Promise.resolve(),
      undefined,
      undefined,
      saveLock,
    );

    await Promise.all([first.save(), second.save()]);

    expect(tmux.calls).toEqual(['runShell:/ext/resources/plugins/tmux-resurrect/scripts/save.sh']);
    expect(saveLock.releases).toBe(1);
  });

  it('saves periodically until disposed', async () => {
    vi.useFakeTimers();
    const tmux = new FakeTmux();
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
    );

    const periodicSave = runtime.startPeriodicSave(300_000);

    await vi.advanceTimersByTimeAsync(299_999);
    expect(tmux.calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(tmux.calls).toEqual(['runShell:/ext/resources/plugins/tmux-resurrect/scripts/save.sh']);

    await vi.advanceTimersByTimeAsync(300_000);
    expect(tmux.calls).toEqual([
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
    ]);

    periodicSave.dispose();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(tmux.calls).toHaveLength(2);
  });

  it('restores on activation by anchoring a dead Deck socket', async () => {
    const tmux = new FakeTmux();
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
    );

    await expect(runtime.restoreOnActivation()).resolves.toEqual({ restored: true });

    expect(tmux.calls).toEqual([
      'killSession:__deck_anchor',
      'newAnchorSession:__deck_anchor:/deck/global-storage',
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      'killSession:__deck_anchor',
    ]);
  });

  it('wraps actual activation restore work in restore feedback', async () => {
    const tmux = new FakeTmux();
    const feedbackCalls: string[] = [];
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
      () => Promise.resolve(),
      undefined,
      {
        withProgress: async (context, task) => {
          feedbackCalls.push(`withProgress:${context.unresponsive}`);
          await task();
          feedbackCalls.push('withProgress.done');
        },
      },
    );

    await expect(runtime.restoreOnActivation()).resolves.toEqual({ restored: true });

    expect(feedbackCalls).toEqual(['withProgress:false', 'withProgress.done']);
    expect(tmux.calls).toEqual([
      'killSession:__deck_anchor',
      'newAnchorSession:__deck_anchor:/deck/global-storage',
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      'killSession:__deck_anchor',
    ]);
  });

  it('does not show restore feedback when wedge recovery only waited for a peer', async () => {
    const tmux = new FakeTmux();
    const restoreFeedback = {
      withProgress: vi.fn(async (_context: { unresponsive: boolean }, task: () => Promise<void>) => task()),
    };
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
      () => Promise.resolve(),
      {
        ensureHealthyServer: async () => {
          tmux.calls.push('wedgeRecovery.waitForPeer');
          return { started: false };
        },
      },
      restoreFeedback,
    );

    await expect(runtime.restoreOnActivation()).resolves.toEqual({ restored: false });

    expect(restoreFeedback.withProgress).not.toHaveBeenCalled();
    expect(tmux.calls).toEqual(['killSession:__deck_anchor', 'wedgeRecovery.waitForPeer']);
  });

  it('recovers a wedged Deck socket before restoring on activation', async () => {
    const tmux = new FakeTmux();
    tmux.newAnchorErrors = [new Error('server exited unexpectedly')];
    const recovery = new WedgeRecovery({
      isServerRunning: () => tmux.isServerRunning(),
      startServer: () => tmux.newAnchorSession('__deck_anchor', '/deck/global-storage'),
      socketPath: () => '/tmp/tmux-1000/deck',
      socketExists: async (path) => {
        tmux.calls.push(`socketExists:${path}`);
        return true;
      },
      removeSocket: async (path) => {
        tmux.calls.push(`removeSocket:${path}`);
      },
      recoveryLock: {
        acquire: async () => {
          tmux.calls.push('lock.acquire');
          return true;
        },
        release: async () => {
          tmux.calls.push('lock.release');
        },
        waitForHealthy: async () => {
          tmux.calls.push('lock.waitForHealthy');
          return true;
        },
      },
    });
    const feedbackContexts: boolean[] = [];
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
      () => Promise.resolve(),
      recovery,
      {
        withProgress: async (context, task) => {
          feedbackContexts.push(context.unresponsive);
          await task();
        },
      },
    );

    await expect(runtime.restoreOnActivation()).resolves.toEqual({ restored: true });

    expect(feedbackContexts).toEqual([true]);
    expect(tmux.calls).toEqual([
      'killSession:__deck_anchor',
      'isServerRunning',
      'newAnchorSession:__deck_anchor:/deck/global-storage',
      'socketExists:/tmp/tmux-1000/deck',
      'socketExists:/tmp/tmux-1000/deck',
      'isServerRunning',
      'socketExists:/tmp/tmux-1000/deck',
      'isServerRunning',
      'socketExists:/tmp/tmux-1000/deck',
      'isServerRunning',
      'lock.acquire',
      'socketExists:/tmp/tmux-1000/deck',
      'isServerRunning',
      'socketExists:/tmp/tmux-1000/deck',
      'isServerRunning',
      'socketExists:/tmp/tmux-1000/deck',
      'isServerRunning',
      'removeSocket:/tmp/tmux-1000/deck',
      'newAnchorSession:__deck_anchor:/deck/global-storage',
      'lock.release',
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      'killSession:__deck_anchor',
    ]);
  });

  it('does not restore when wedge recovery only waited for a peer', async () => {
    const tmux = new FakeTmux();
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
      () => Promise.resolve(),
      {
        ensureHealthyServer: async () => {
          tmux.calls.push('wedgeRecovery.waitForPeer');
          return { started: false };
        },
      },
    );

    await expect(runtime.restoreOnActivation()).resolves.toEqual({ restored: false });

    expect(tmux.calls).toEqual([
      'killSession:__deck_anchor',
      'wedgeRecovery.waitForPeer',
    ]);
  });

  it('rewrites the TerminalSnapshot before restore.sh runs', async () => {
    const tmux = new FakeTmux();
    const rewrite = vi.fn(async () => {
      tmux.calls.push('rewriteSnapshot');
    });
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
      rewrite,
    );

    await expect(runtime.restoreOnActivation()).resolves.toEqual({ restored: true });

    expect(tmux.calls).toEqual([
      'killSession:__deck_anchor',
      'newAnchorSession:__deck_anchor:/deck/global-storage',
      'rewriteSnapshot',
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      'killSession:__deck_anchor',
    ]);
  });

  it('clears a stale anchor before starting restore', async () => {
    const tmux = new FakeTmux();
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
    );

    await runtime.restoreOnActivation();

    // A crashed prior restore can leave an anchor that keeps an empty server alive.
    expect(tmux.calls.indexOf('killSession:__deck_anchor')).toBeLessThan(
      tmux.calls.indexOf('newAnchorSession:__deck_anchor:/deck/global-storage'),
    );
  });

  it('kills the anchor and does not throw when restore fails', async () => {
    const tmux = new FakeTmux();
    tmux.runShellError = new Error('restore failed');
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
    );

    await expect(runtime.restoreOnActivation()).resolves.toEqual({ restored: false });

    expect(tmux.calls).toEqual([
      'killSession:__deck_anchor',
      'newAnchorSession:__deck_anchor:/deck/global-storage',
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      'killSession:__deck_anchor',
    ]);
  });
});
