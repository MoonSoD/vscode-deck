import { describe, expect, it } from 'vitest';
import { excludePending } from '../src/tree/excludePending';

describe('excludePending', () => {
  it('filters pending worktree removals and preserves the remaining order', () => {
    const worktrees = [
      {
        path: '/work/alpha-main',
        head: 'a',
        bare: false,
        detached: false,
        branch: 'main',
      },
      {
        path: '/work/alpha-feature',
        head: 'aa',
        bare: false,
        detached: false,
        branch: 'feature',
      },
      {
        path: '/work/alpha-spike',
        head: 'aaa',
        bare: false,
        detached: false,
        branch: 'spike',
      },
    ];

    expect(excludePending(worktrees, new Set(['/work/alpha-feature']))).toEqual([
      worktrees[0],
      worktrees[2],
    ]);
  });
});
