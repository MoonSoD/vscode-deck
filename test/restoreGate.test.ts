import { describe, expect, it, vi } from 'vitest';
import { createRestoreCoordinator } from '../src/terminal/restoreGate';

describe('createRestoreCoordinator', () => {
  it('classifies a missing DeckSocket as down', async () => {
    const coordinator = createRestoreCoordinator({
      listSessions: async () => [],
      restore: async () => undefined,
    });

    await expect(coordinator.classify()).resolves.toEqual({ kind: 'down' });
  });

  it('classifies real sessions as restored without exposing the anchor', async () => {
    const coordinator = createRestoreCoordinator({
      listSessions: async () => [
        { sessionName: '__deck_anchor' },
        { sessionName: 'wt-_work_alpha-main__term-1' },
      ],
      restore: async () => undefined,
    });

    await expect(coordinator.classify()).resolves.toEqual({
      kind: 'restored',
      sessions: new Set(['wt-_work_alpha-main__term-1']),
    });
  });

  it('restores when the DeckSocket has only the anchor session', async () => {
    const restore = vi.fn(async () => undefined);
    const coordinator = createRestoreCoordinator({
      listSessions: async () => [{ sessionName: '__deck_anchor' }],
      restore,
    });

    await coordinator.ensureRestored();

    expect(restore).toHaveBeenCalledOnce();
  });

  it('skips restore when real sessions already exist', async () => {
    const restore = vi.fn(async () => undefined);
    const coordinator = createRestoreCoordinator({
      listSessions: async () => [{ sessionName: 'wt-_work_alpha-main__term-1' }],
      restore,
    });

    await coordinator.ensureRestored();

    expect(restore).not.toHaveBeenCalled();
  });

  it('returns down after an empty snapshot restore without looping', async () => {
    const restore = vi.fn(async () => undefined);
    const coordinator = createRestoreCoordinator({
      listSessions: async () => [],
      restore,
    });

    await expect(coordinator.ensureRestored()).resolves.toEqual({ kind: 'down' });

    expect(restore).toHaveBeenCalledOnce();
  });

  it('shares one in-flight restore across concurrent callers', async () => {
    let release!: () => void;
    const restore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    let restored = false;
    const coordinator = createRestoreCoordinator({
      listSessions: async () =>
        restored ? [{ sessionName: 'wt-_work_alpha-main__term-1' }] : [],
      restore: async () => {
        await restore();
        restored = true;
      },
    });

    const a = coordinator.ensureRestored();
    const b = coordinator.ensureRestored();
    const c = coordinator.ensureRestored();
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(coordinator.classify()).resolves.toMatchObject({ kind: 'restoring' });

    release();
    await Promise.all([a, b, c]);

    expect(restore).toHaveBeenCalledOnce();
  });

  it('serializes restore across coordinators sharing a snapshot lock', async () => {
    let restored = false;
    let finishRestore!: () => void;
    const restoreDone = new Promise<void>((resolve) => {
      finishRestore = () => {
        restored = true;
        resolve();
      };
    });
    const restore = vi.fn(async () => {
      if (restore.mock.calls.length === 1) await restoreDone;
      restored = true;
    });
    const restoreLock = new FakeRestoreLock();
    const deps = {
      listSessions: async () =>
        restored ? [{ sessionName: 'wt-_work_alpha-main__term-1' }] : [],
      restore,
      restoreLock,
    };
    const first = createRestoreCoordinator(deps);
    const second = createRestoreCoordinator(deps);

    const a = first.ensureRestored();
    const b = second.ensureRestored();
    await new Promise((resolve) => setImmediate(resolve));

    expect(restore).toHaveBeenCalledOnce();

    finishRestore();
    await Promise.all([a, b]);

    expect(restore).toHaveBeenCalledOnce();
  });

  it('falls back when the first coordinator fails while holding the snapshot lock', async () => {
    let restored = false;
    let failFirstRestore!: () => void;
    const firstRestore = new Promise<void>((_resolve, reject) => {
      failFirstRestore = () => reject(new Error('winner died'));
    });
    const restore = vi.fn(async () => {
      if (restore.mock.calls.length === 1) {
        await firstRestore;
        return;
      }
      restored = true;
    });
    const deps = {
      listSessions: async () =>
        restored ? [{ sessionName: 'wt-_work_alpha-main__term-1' }] : [],
      restore,
      restoreLock: new FakeRestoreLock(),
    };
    const first = createRestoreCoordinator(deps);
    const second = createRestoreCoordinator(deps);

    const firstResult = first.ensureRestored();
    const secondResult = second.ensureRestored();
    await new Promise((resolve) => setImmediate(resolve));

    expect(restore).toHaveBeenCalledOnce();

    failFirstRestore();

    await expect(firstResult).rejects.toThrow('winner died');
    await expect(secondResult).resolves.toEqual({
      kind: 'restored',
      sessions: new Set(['wt-_work_alpha-main__term-1']),
    });
    expect(restore).toHaveBeenCalledTimes(2);
  });

  it('falls back when the first coordinator restores no sessions', async () => {
    let restored = false;
    let finishFirstRestore!: () => void;
    const firstRestore = new Promise<void>((resolve) => {
      finishFirstRestore = resolve;
    });
    const restore = vi.fn(async () => {
      if (restore.mock.calls.length === 1) {
        await firstRestore;
        return;
      }
      restored = true;
    });
    const deps = {
      listSessions: async () =>
        restored ? [{ sessionName: 'wt-_work_alpha-main__term-1' }] : [],
      restore,
      restoreLock: new FakeRestoreLock(),
    };
    const first = createRestoreCoordinator(deps);
    const second = createRestoreCoordinator(deps);

    const firstResult = first.ensureRestored();
    const secondResult = second.ensureRestored();
    await new Promise((resolve) => setImmediate(resolve));

    expect(restore).toHaveBeenCalledOnce();

    finishFirstRestore();

    await expect(Promise.all([firstResult, secondResult])).resolves.toEqual([
      { kind: 'restored', sessions: new Set(['wt-_work_alpha-main__term-1']) },
      { kind: 'restored', sessions: new Set(['wt-_work_alpha-main__term-1']) },
    ]);
    expect(restore).toHaveBeenCalledTimes(2);
  });

  it('fails open when the snapshot lock cannot be acquired before timeout', async () => {
    let restored = false;
    const restore = vi.fn(async () => {
      restored = true;
    });
    const coordinator = createRestoreCoordinator({
      listSessions: async () =>
        restored ? [{ sessionName: 'wt-_work_alpha-main__term-1' }] : [],
      restore,
      restoreLock: {
        acquireBlocking: async () => false,
        release: vi.fn(async () => undefined),
      },
    });

    await expect(coordinator.ensureRestored()).resolves.toEqual({
      kind: 'restored',
      sessions: new Set(['wt-_work_alpha-main__term-1']),
    });

    expect(restore).toHaveBeenCalledOnce();
  });

  it('waits for a held snapshot lock before restoring', async () => {
    let restored = false;
    const restore = vi.fn(async () => {
      restored = true;
    });
    const snapshotLock = new FakeRestoreLock();
    await snapshotLock.acquireBlocking();
    const coordinator = createRestoreCoordinator({
      listSessions: async () =>
        restored ? [{ sessionName: 'wt-_work_alpha-main__term-1' }] : [],
      restore,
      restoreLock: snapshotLock,
    });

    const restoreResult = coordinator.ensureRestored();
    await new Promise((resolve) => setImmediate(resolve));

    expect(restore).not.toHaveBeenCalled();

    await snapshotLock.release();
    await expect(restoreResult).resolves.toEqual({
      kind: 'restored',
      sessions: new Set(['wt-_work_alpha-main__term-1']),
    });
  });

  it('restores again after a later DeckSocket death', async () => {
    const restore = vi.fn(async () => undefined);
    let sessions: Array<{ sessionName: string }> = [];
    const coordinator = createRestoreCoordinator({
      listSessions: async () => sessions,
      restore,
    });

    await coordinator.ensureRestored();
    sessions = [{ sessionName: 'wt-_work_alpha-main__term-1' }];
    await coordinator.ensureRestored();
    sessions = [];
    await coordinator.ensureRestored();

    expect(restore).toHaveBeenCalledTimes(2);
  });
});

class FakeRestoreLock {
  private held = false;
  private readonly waiters: Array<() => void> = [];

  async acquireBlocking(): Promise<boolean> {
    if (this.held) {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    this.held = true;
    return true;
  }

  async release(): Promise<void> {
    this.held = false;
    this.waiters.shift()?.();
  }
}
