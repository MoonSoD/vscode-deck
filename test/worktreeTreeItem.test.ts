import { describe, expect, it } from 'vitest';
import { describeWorktreeTreeItem } from '../src/tree/worktreeTreeItem';

describe('describeWorktreeTreeItem', () => {
  it('marks only the stored active worktree path as active', () => {
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
        head: 'b',
        bare: false,
        detached: false,
        branch: 'feature',
      },
    ];

    expect(
      worktrees.map((worktree) => describeWorktreeTreeItem(worktree, '/work/alpha-main')),
    ).toEqual([
      {
        label: 'main',
        description: '/work/alpha-main',
        iconId: 'check',
        contextValue: 'worktree.active',
      },
      {
        label: 'feature',
        description: '/work/alpha-feature',
        iconId: 'git-branch',
        contextValue: 'worktree',
      },
    ]);
  });
});
