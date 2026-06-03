import { describe, expect, it } from 'vitest';
import { WorkspaceRootPlanner } from '../src/switch/workspaceRootPlanner';

describe('WorkspaceRootPlanner.planSwap', () => {
  it('swaps the root with the matching common dir and preserves other roots', () => {
    const current = [
      { path: '/work/alpha-main', commonDir: '/git/alpha' },
      { path: '/work/beta-main', commonDir: '/git/beta' },
      { path: '/work/gamma-main', commonDir: '/git/gamma' },
    ];
    const target = { path: '/work/beta-feature', commonDir: '/git/beta' };

    expect(WorkspaceRootPlanner.planSwap(current, target)).toEqual([
      { path: '/work/alpha-main', commonDir: '/git/alpha' },
      { path: '/work/beta-feature', commonDir: '/git/beta' },
      { path: '/work/gamma-main', commonDir: '/git/gamma' },
    ]);
  });

  it('returns the current roots when no mounted root matches the target common dir', () => {
    const current = [
      { path: '/work/alpha-main', commonDir: '/git/alpha' },
      { path: '/work/beta-main', commonDir: '/git/beta' },
    ];

    expect(
      WorkspaceRootPlanner.planSwap(current, {
        path: '/work/gamma-main',
        commonDir: '/git/gamma',
      }),
    ).toBe(current);
  });

  it('returns the current roots when the target worktree is already active', () => {
    const current = [
      { path: '/work/alpha-main', commonDir: '/git/alpha' },
      { path: '/work/beta-feature', commonDir: '/git/beta' },
    ];

    expect(
      WorkspaceRootPlanner.planSwap(current, {
        path: '/work/beta-feature',
        commonDir: '/git/beta',
      }),
    ).toBe(current);
  });
});
