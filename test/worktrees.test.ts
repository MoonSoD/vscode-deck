import { describe, expect, it } from 'vitest';
import { parseBranchRefs, parsePorcelain } from '../src/git/worktrees';

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

  it('parses locked worktree entries', () => {
    expect(
      parsePorcelain(`worktree /repo/locked
HEAD abc123
branch refs/heads/feature
locked because

`),
    ).toEqual([
      {
        path: '/repo/locked',
        head: 'abc123',
        branch: 'feature',
        bare: false,
        detached: false,
        locked: true,
      },
    ]);
  });
});

describe('parseBranchRefs', () => {
  it('dedupes branch refs and omits remote HEAD aliases', () => {
    expect(
      parseBranchRefs(`main
feature/foo
origin/HEAD
origin/main
origin/feature/foo
feature/foo
`),
    ).toEqual(['main', 'feature/foo', 'origin/main', 'origin/feature/foo']);
  });
});
