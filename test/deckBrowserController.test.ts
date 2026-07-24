import { describe, expect, it, vi } from 'vitest';
import {
  DeckBrowserController,
  type BrowserStateLike,
  type ChromeLauncherLike,
  type CdpClientLike,
  type DeckBrowserControllerDeps,
} from '../src/browser/deckBrowserController';
import type { BrowserWorktreeState } from '../src/browser/browserStateStore';
import type { CdpTarget } from '../src/browser/cdpClient';
import { previewPort, previewProfileDir, previewUrl } from '../src/browser/previewPort';

const worktree = '/work/repo/foo';
const def = { name: 'app', portBase: 3000 };
const url = previewUrl(worktree, def);
const port = previewPort(worktree, def);
const profileDir = previewProfileDir('/data/deck', worktree);

function fakeState(initial: BrowserWorktreeState = {}): BrowserStateLike & { current(): BrowserWorktreeState } {
  let value: BrowserWorktreeState = { ...initial };
  return {
    get: async () => value,
    patch: async (_w, patch) => { value = { ...value, ...patch }; return value; },
    delete: async () => { value = {}; },
    current: () => value,
  };
}

function fakeLauncher() {
  const launches: { url: string; userDataDir: string; debugPort: number }[] = [];
  let raises = 0;
  const launcher: ChromeLauncherLike = {
    launch: (options) => { launches.push(options); return { pid: 4242 }; },
    raiseApp: () => { raises += 1; },
  };
  return { launcher, launches, raises: () => raises };
}

function fakeCdp(options: { up?: boolean; targets?: CdpTarget[] } = {}) {
  const activated: string[] = [];
  const closed: string[] = [];
  const cdp: CdpClientLike = {
    version: async () => (options.up ? { browser: 'Chrome' } : undefined),
    listTargets: async () => options.targets ?? [],
    activate: async (_port, targetId) => { activated.push(targetId); },
    close: async (_port, targetId) => { closed.push(targetId); },
  };
  return { cdp, activated, closed };
}

function build(overrides: Partial<DeckBrowserControllerDeps>): DeckBrowserController {
  return new DeckBrowserController({
    launcher: fakeLauncher().launcher,
    cdp: fakeCdp().cdp,
    state: fakeState(),
    deckDir: '/data/deck',
    allocatePort: async () => 9400,
    profileTemplate: () => undefined,
    copyDir: vi.fn(async () => undefined),
    removeDir: vi.fn(async () => undefined),
    killPid: vi.fn(),
    ...overrides,
  });
}

describe('DeckBrowserController.openOrReveal', () => {
  it('launches a fresh instance when none is running, persisting the allocated debug port', async () => {
    const state = fakeState();
    const launcher = fakeLauncher();
    await build({ state, launcher: launcher.launcher, allocatePort: async () => 9400 }).openOrReveal(worktree, def);

    expect(launcher.launches).toEqual([{ url, userDataDir: profileDir, debugPort: 9400 }]);
    expect(state.current()).toEqual({ debugPort: 9400, profileSeeded: true, pid: 4242 });
    expect(launcher.raises()).toBe(1);
  });

  it('reveals the existing window instead of launching when the target is already open', async () => {
    const state = fakeState({ debugPort: 9400 });
    const launcher = fakeLauncher();
    const { cdp, activated } = fakeCdp({
      up: true,
      targets: [{ id: 'T1', type: 'page', title: 'App', url: `http://localhost:${port}/` }],
    });
    await build({ state, launcher: launcher.launcher, cdp }).openOrReveal(worktree, def);

    expect(activated).toEqual(['T1']);
    expect(launcher.launches).toEqual([]);
    expect(launcher.raises()).toBe(1);
  });

  it('opens a new window in the running instance when that preview is not yet open', async () => {
    const state = fakeState({ debugPort: 9400 });
    const launcher = fakeLauncher();
    const { cdp } = fakeCdp({ up: true, targets: [] });
    await build({ state, launcher: launcher.launcher, cdp }).openOrReveal(worktree, def);

    expect(launcher.launches).toEqual([{ url, userDataDir: profileDir, debugPort: 9400 }]);
  });

  it('seeds the profile from the template on first launch only', async () => {
    const copyDir = vi.fn(async () => undefined);
    await build({ profileTemplate: () => '/tpl/profile', copyDir }).openOrReveal(worktree, def);
    expect(copyDir).toHaveBeenCalledWith('/tpl/profile', profileDir);
  });

  it('does not re-seed a profile that was already seeded', async () => {
    const copyDir = vi.fn(async () => undefined);
    await build({
      state: fakeState({ profileSeeded: true }),
      profileTemplate: () => '/tpl/profile',
      copyDir,
    }).openOrReveal(worktree, def);
    expect(copyDir).not.toHaveBeenCalled();
  });
});

describe('DeckBrowserController.close', () => {
  it('closes the target matching the preview port', async () => {
    const { cdp, closed } = fakeCdp({
      up: true,
      targets: [{ id: 'T9', type: 'page', title: 'App', url: `http://127.0.0.1:${port}/x` }],
    });
    await build({ state: fakeState({ debugPort: 9400 }), cdp }).close(worktree, def);
    expect(closed).toEqual(['T9']);
  });
});

describe('DeckBrowserController.reload', () => {
  it('closes the current window then reopens it', async () => {
    const launcher = fakeLauncher();
    const { cdp, closed } = fakeCdp({
      up: true,
      targets: [{ id: 'T5', type: 'page', title: 'App', url: `http://localhost:${port}/` }],
    });
    await build({ state: fakeState({ debugPort: 9400 }), cdp, launcher: launcher.launcher })
      .reload(worktree, def);

    expect(closed).toEqual(['T5']);
    // After closing, the reopen finds the target still listed (fake list is
    // static) and reveals it — either way the window is brought back.
    expect(launcher.raises()).toBe(1);
  });
});

describe('DeckBrowserController.closeWorktree', () => {
  it('kills the instance, removes the profile, and clears state', async () => {
    const killPid = vi.fn();
    const removeDir = vi.fn(async () => undefined);
    const state = fakeState({ debugPort: 9400, pid: 4242 });
    await build({ state, killPid, removeDir }).closeWorktree(worktree);

    expect(killPid).toHaveBeenCalledWith(4242);
    expect(removeDir).toHaveBeenCalledWith(profileDir);
    expect(state.current()).toEqual({});
  });
});
