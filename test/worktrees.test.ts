import { describe, expect, it } from 'vitest';
import { parsePorcelain } from '../src/git/worktrees';

describe('parsePorcelain', () => {
  it('parses normal, detached, and bare worktree entries', () => {
    expect(
      parsePorcelain(`worktree /repo/main
HEAD abc123
branch refs/heads/main

worktree /repo/detached
HEAD def456
detached

worktree /repo/bare
HEAD 000000
bare

`),
    ).toEqual([
      {
        path: '/repo/main',
        head: 'abc123',
        branch: 'main',
        bare: false,
        detached: false,
      },
      {
        path: '/repo/detached',
        head: 'def456',
        branch: undefined,
        bare: false,
        detached: true,
      },
      {
        path: '/repo/bare',
        head: '000000',
        branch: undefined,
        bare: true,
        detached: false,
      },
    ]);
  });
});
