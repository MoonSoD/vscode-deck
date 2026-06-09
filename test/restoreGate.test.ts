import { describe, expect, it, vi } from 'vitest';
import { createRestoreGate } from '../src/terminal/restoreGate';

describe('createRestoreGate', () => {
  it('restores when the DeckSocket is dead, before letting the reattach proceed', async () => {
    const restore = vi.fn(async () => undefined);
    const gate = createRestoreGate({ isServerRunning: async () => false, restore });

    await gate();

    expect(restore).toHaveBeenCalledOnce();
  });

  it('skips restore when the server is alive (reattach binds to the existing session)', async () => {
    const restore = vi.fn(async () => undefined);
    const gate = createRestoreGate({ isServerRunning: async () => true, restore });

    await gate();

    expect(restore).not.toHaveBeenCalled();
  });

  it('shares one in-flight restore across concurrent reattaches after a death', async () => {
    let release!: () => void;
    const restore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const gate = createRestoreGate({ isServerRunning: async () => false, restore });

    const a = gate();
    const b = gate();
    const c = gate();
    // Let each gate's isServerRunning() settle so the (single) restore is called.
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await Promise.all([a, b, c]);

    expect(restore).toHaveBeenCalledOnce();
  });

  it('re-restores on a later death (not a one-shot barrier)', async () => {
    const restore = vi.fn(async () => undefined);
    let alive = false;
    const gate = createRestoreGate({ isServerRunning: async () => alive, restore });

    await gate(); // dead → restore (1)
    alive = true;
    await gate(); // alive → skip
    alive = false;
    await gate(); // dead again → restore (2)

    expect(restore).toHaveBeenCalledTimes(2);
  });
});
