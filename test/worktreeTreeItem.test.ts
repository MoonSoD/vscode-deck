import { describe, expect, it } from 'vitest';
import {
  describeRepositoryTreeItem,
  describeWorktreeTreeItem,
} from '../src/tree/worktreeTreeItem';

describe('describeRepositoryTreeItem', () => {
  it('marks the repository matching the open workspace folder common dir as active', () => {
    expect(describeRepositoryTreeItem('/work/alpha', true)).toEqual({
      label: 'alpha',
      description: 'active',
      iconId: 'folder',
    });

    expect(describeRepositoryTreeItem('/work/beta', false)).toEqual({
      label: 'beta',
      description: '',
      iconId: 'folder',
    });
  });
});

describe('describeWorktreeTreeItem', () => {
  it('marks active and main worktree rows with delete-scoping context values', () => {
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
      worktrees.map((worktree) =>
        describeWorktreeTreeItem(worktree, '/work/alpha-main', '/work/alpha-feature'),
      ),
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
        contextValue: 'deck.worktree.main',
      },
    ]);

    expect(
      describeWorktreeTreeItem(worktrees[0], '/work/alpha-main', '/work/alpha-main')
        .contextValue,
    ).toBe('deck.worktree.active');
    expect(
      describeWorktreeTreeItem(worktrees[1], '/work/alpha-main', '/work/other')
        .contextValue,
    ).toBe('deck.worktree');
  });
});
