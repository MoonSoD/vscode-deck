import { describe, expect, it } from 'vitest';
import {
  previewEnv,
  previewPort,
  previewProfileDir,
  previewUrl,
  worktreeSlot,
} from '../src/browser/previewPort';

const app = { name: 'app', portBase: 3000 };
const storybook = { name: 'storybook', portBase: 6006 };

describe('worktreeSlot', () => {
  it('is stable for the same worktree and within the slot span', () => {
    const slot = worktreeSlot('/work/repo/sm/CAR-123/foo');
    expect(slot).toBe(worktreeSlot('/work/repo/sm/CAR-123/foo'));
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(slot).toBeLessThan(100);
  });

  it('is unchanged by a trailing slash (path is resolved first)', () => {
    expect(worktreeSlot('/work/repo/foo/')).toBe(worktreeSlot('/work/repo/foo'));
  });
});

describe('previewPort / previewUrl', () => {
  it('offsets each definition base by the worktree slot, shared across previews', () => {
    const worktree = '/work/repo/sm/CAR-123/foo';
    const slot = worktreeSlot(worktree);
    expect(previewPort(worktree, app)).toBe(3000 + slot);
    expect(previewPort(worktree, storybook)).toBe(6006 + slot);
  });

  it('builds a localhost URL, defaulting the path to /', () => {
    const worktree = '/work/repo/foo';
    const port = previewPort(worktree, app);
    expect(previewUrl(worktree, app)).toBe(`http://localhost:${port}/`);
    expect(previewUrl(worktree, { name: 'sb', portBase: 6006, path: '/x' })).toBe(
      `http://localhost:${previewPort(worktree, { name: 'sb', portBase: 6006 })}/x`,
    );
  });
});

describe('previewEnv', () => {
  it('maps each preview with a portEnv to its PreviewPort, skipping those without one', () => {
    const worktree = '/work/repo/foo';
    expect(previewEnv(worktree, [
      { name: 'app', portBase: 3000, portEnv: 'PORT' },
      { name: 'storybook', portBase: 6006, portEnv: 'STORYBOOK_PORT' },
      { name: 'admin', portBase: 4000 },
    ])).toEqual({
      PORT: String(previewPort(worktree, { name: 'app', portBase: 3000 })),
      STORYBOOK_PORT: String(previewPort(worktree, { name: 'storybook', portBase: 6006 })),
    });
  });

  it('is empty when no preview declares a portEnv', () => {
    expect(previewEnv('/work/repo/foo', [{ name: 'app', portBase: 3000 }])).toEqual({});
  });
});

describe('previewProfileDir', () => {
  it('is a stable, filesystem-safe dir under the deck chrome dir with a readable prefix', () => {
    const dir = previewProfileDir('/data/deck', '/work/repo/sm/CAR-123/foo bar');
    expect(dir).toBe(previewProfileDir('/data/deck', '/work/repo/sm/CAR-123/foo bar'));
    expect(dir.startsWith('/data/deck/chrome/')).toBe(true);
    expect(dir).toMatch(/\/chrome\/foo-bar-[0-9a-f]{8}$/);
  });

  it('gives different worktrees different profile dirs', () => {
    expect(previewProfileDir('/data/deck', '/work/a')).not.toBe(
      previewProfileDir('/data/deck', '/work/b'),
    );
  });
});
