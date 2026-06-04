import { describe, expect, it } from 'vitest';
import {
  describeProjectTreeItem,
  describeWorktreeTreeItem,
} from '../src/tree/worktreeTreeItem';

describe('describeProjectTreeItem', () => {
  it('marks the project matching the open workspace folder common dir as active', () => {
    expect(describeProjectTreeItem('/work/alpha', true)).toEqual({
      label: 'alpha',
      description: 'active',
      iconId: 'repo',
    });

    expect(describeProjectTreeItem('/work/beta', false)).toEqual({
      label: 'beta',
      description: '',
      iconId: 'repo',
    });
  });
});

describe('describeWorktreeTreeItem', () => {
  it('marks only the provided active worktree path as active', () => {
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
        contextValue: 'deck.worktree.active',
      },
      {
        label: 'feature',
        description: '/work/alpha-feature',
        iconId: 'git-branch',
        contextValue: 'deck.worktree',
      },
    ]);
  });
});
