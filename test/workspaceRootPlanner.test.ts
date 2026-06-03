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

describe('WorkspaceRootPlanner.planReconcile', () => {
  it('appends registered roots that are not already mounted', () => {
    const current = [
      { path: '/work/alpha-main', commonDir: '/git/alpha' },
      { path: '/work/beta-main', commonDir: '/git/beta' },
    ];
    const registry = [
      { path: '/work/beta-feature', commonDir: '/git/beta' },
      { path: '/work/gamma-feature', commonDir: '/git/gamma' },
    ];

    expect(WorkspaceRootPlanner.planReconcile(current, registry)).toEqual([
      { path: '/work/alpha-main', commonDir: '/git/alpha' },
      { path: '/work/beta-main', commonDir: '/git/beta' },
      { path: '/work/gamma-feature', commonDir: '/git/gamma' },
    ]);
  });

  it('returns the current roots when every registered project is already mounted', () => {
    const current = [
      { path: '/work/alpha-main', commonDir: '/git/alpha' },
      { path: '/work/beta-main', commonDir: '/git/beta' },
    ];
    const registry = [
      { path: '/work/alpha-feature', commonDir: '/git/alpha' },
      { path: '/work/beta-feature', commonDir: '/git/beta' },
    ];

    expect(WorkspaceRootPlanner.planReconcile(current, registry)).toBe(current);
  });

  it('deduplicates registered projects by common dir', () => {
    const current = [{ path: '/work/alpha-main', commonDir: '/git/alpha' }];
    const registry = [
      { path: '/work/beta-main', commonDir: '/git/beta' },
      { path: '/work/beta-feature', commonDir: '/git/beta' },
    ];

    expect(WorkspaceRootPlanner.planReconcile(current, registry)).toEqual([
      { path: '/work/alpha-main', commonDir: '/git/alpha' },
      { path: '/work/beta-main', commonDir: '/git/beta' },
    ]);
  });
});
