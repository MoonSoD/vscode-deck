import { describe, expect, it } from 'vitest';
import { Worktree } from '../src/git/worktrees';
import { reconcileWorktreeOrder } from '../src/tree/reconcileWorktreeOrder';

function worktree(path: string): Worktree {
  return {
    path,
    head: path,
    bare: false,
    detached: false,
    branch: path,
  };
}

describe('reconcileWorktreeOrder', () => {
  it('returns git worktrees verbatim when no order is stored', () => {
    const gitWorktrees = [worktree('/work/main'), worktree('/work/feature')];

    expect(reconcileWorktreeOrder(undefined, gitWorktrees)).toBe(gitWorktrees);
  });

  it('puts stored worktrees first and appends unknown worktrees in git order', () => {
    const gitWorktrees = [
      worktree('/work/main'),
      worktree('/work/feature-a'),
      worktree('/work/feature-b'),
      worktree('/work/feature-c'),
    ];

    expect(
      reconcileWorktreeOrder(
        ['/work/feature-b', '/work/main'],
        gitWorktrees,
      ).map((w) => w.path),
    ).toEqual([
      '/work/feature-b',
      '/work/main',
      '/work/feature-a',
      '/work/feature-c',
    ]);
  });

  it('drops stale stored paths while preserving kept order', () => {
    const gitWorktrees = [
      worktree('/work/main'),
      worktree('/work/feature-a'),
      worktree('/work/feature-b'),
    ];

    expect(
      reconcileWorktreeOrder(
        ['/stale', '/work/feature-b', '/missing', '/work/main'],
        gitWorktrees,
      ).map((w) => w.path),
    ).toEqual(['/work/feature-b', '/work/main', '/work/feature-a']);
  });

  it('returns git order when all stored paths are stale', () => {
    const gitWorktrees = [worktree('/work/main'), worktree('/work/feature')];

    expect(
      reconcileWorktreeOrder(['/stale-a', '/stale-b'], gitWorktrees).map(
        (w) => w.path,
      ),
    ).toEqual(['/work/main', '/work/feature']);
  });

  it('returns empty when git has no worktrees', () => {
    expect(reconcileWorktreeOrder(['/work/main'], [])).toEqual([]);
  });
});
