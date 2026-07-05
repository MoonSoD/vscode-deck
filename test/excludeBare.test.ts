import { describe, expect, it } from 'vitest';
import { excludeBare } from '../src/tree/excludeBare';

describe('excludeBare', () => {
  it('filters bare worktrees and preserves detached and branch worktrees in order', () => {
    const worktrees = [
      {
        path: '/work/alpha-main',
        head: 'a',
        bare: false,
        detached: false,
        branch: 'main',
      },
      {
        path: '/work/alpha-detached',
        head: 'aa',
        bare: false,
        detached: true,
      },
      {
        path: '/git/alpha',
        head: '',
        bare: true,
        detached: false,
      },
    ];

    expect(excludeBare(worktrees)).toEqual([
      worktrees[0],
      worktrees[1],
    ]);
  });
});
