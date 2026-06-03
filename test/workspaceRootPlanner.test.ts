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

  it('preserves non-git folders while swapping the matching root', () => {
    const current = [
      { path: '/notes', commonDir: null },
      { path: '/work/beta-main', commonDir: '/git/beta' },
    ];
    const target = { path: '/work/beta-feature', commonDir: '/git/beta' };

    expect(WorkspaceRootPlanner.planSwap(current, target)).toEqual([
      { path: '/notes', commonDir: null },
      { path: '/work/beta-feature', commonDir: '/git/beta' },
    ]);
  });

  it('returns the current roots when the target itself is not a git worktree', () => {
    const current = [
      { path: '/notes', commonDir: null },
      { path: '/work/beta-main', commonDir: '/git/beta' },
    ];

    expect(
      WorkspaceRootPlanner.planSwap(current, { path: '/scratch', commonDir: null }),
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

  it('appends registered roots alongside a non-git folder, preserving it', () => {
    const current = [
      { path: '/notes', commonDir: null },
      { path: '/work/alpha-main', commonDir: '/git/alpha' },
    ];
    const registry = [{ path: '/work/beta-main', commonDir: '/git/beta' }];

    expect(WorkspaceRootPlanner.planReconcile(current, registry)).toEqual([
      { path: '/notes', commonDir: null },
      { path: '/work/alpha-main', commonDir: '/git/alpha' },
      { path: '/work/beta-main', commonDir: '/git/beta' },
    ]);
  });
});

describe('WorkspaceRootPlanner.planRecovery', () => {
  it('replaces a missing mounted active worktree with the project main worktree', () => {
    const current = [
      { path: '/work/alpha-main', commonDir: '/git/alpha', exists: true },
      { path: '/work/beta-feature', commonDir: '/git/beta', exists: false },
    ];
    const projects = [
      {
        commonDir: '/git/beta',
        activePath: '/work/beta-feature',
        mainRoot: { path: '/work/beta-main', commonDir: '/git/beta' },
      },
    ];

    expect(WorkspaceRootPlanner.planRecovery(current, projects)).toEqual({
      roots: [
        { path: '/work/alpha-main', commonDir: '/git/alpha' },
        { path: '/work/beta-main', commonDir: '/git/beta' },
      ],
      recovered: [
        {
          index: 1,
          missingPath: '/work/beta-feature',
          recoveryPath: '/work/beta-main',
          commonDir: '/git/beta',
        },
      ],
      unrecoverable: [],
    });
  });

  it('leaves a missing root unrecovered when the project has no surviving worktrees', () => {
    const current = [
      { path: '/work/beta-feature', commonDir: '/git/beta', exists: false },
    ];

    expect(
      WorkspaceRootPlanner.planRecovery(current, [
        { commonDir: '/git/beta', activePath: '/work/beta-feature' },
      ]),
    ).toEqual({
      roots: [{ path: '/work/beta-feature', commonDir: '/git/beta' }],
      recovered: [],
      unrecoverable: [
        { missingPath: '/work/beta-feature', commonDir: '/git/beta' },
      ],
    });
  });

  it('preserves missing roots that do not belong to a registered project', () => {
    const current = [{ path: '/scratch', commonDir: null, exists: false }];

    expect(WorkspaceRootPlanner.planRecovery(current, [])).toEqual({
      roots: [{ path: '/scratch', commonDir: null }],
      recovered: [],
      unrecoverable: [],
    });
  });
});
