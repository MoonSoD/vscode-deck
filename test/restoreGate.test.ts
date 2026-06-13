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
