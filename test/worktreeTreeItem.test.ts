import { describe, expect, it } from 'vitest';
import {
  describeRepositoryTreeItem,
  describeTerminalTreeItem,
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

  it('does not render agent status rollups in the repository description', () => {
    expect(describeRepositoryTreeItem('/work/alpha', false).description).toBe('');
    expect(describeRepositoryTreeItem('/work/alpha', true).description).toBe('active');
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

  it('does not render agent status rollups in the worktree description', () => {
    const worktree = {
      path: '/work/alpha-feature',
      head: 'b',
      bare: false,
      detached: false,
      branch: 'feature',
    };

    expect(describeWorktreeTreeItem(worktree, '/work/alpha-main', '/work/alpha-main').description)
      .toBe('/work/alpha-feature');
  });
});

describe('describeTerminalTreeItem', () => {
  it('renders in-progress agent status as a loading row without inline status text', () => {
    expect(describeTerminalTreeItem('claude', false, { status: 'inProgress', statusAt: 1710000000 })).toEqual({
      label: 'claude',
      iconId: 'agent-working',
      contextValue: 'deck.terminal.foreign',
    });
  });

  it('renders non-working agent statuses with the agent identity glyph', () => {
    expect(describeTerminalTreeItem('claude', false, { status: 'needsInput', statusAt: 1710000000 })).toEqual({
      label: 'claude',
      iconId: 'agent',
      contextValue: 'deck.terminal.foreign',
    });
    expect(describeTerminalTreeItem('claude', false, {
      status: 'completed',
      statusAt: 1710000000,
      unread: true,
    })).toEqual({
      label: 'claude',
      iconId: 'agent',
      contextValue: 'deck.terminal.foreign',
    });
    expect(describeTerminalTreeItem('claude', false, {
      status: 'completed',
      statusAt: 1710000000,
      unread: false,
    })).toEqual({
      label: 'claude',
      iconId: 'agent',
      contextValue: 'deck.terminal.foreign',
    });
    expect(describeTerminalTreeItem('claude', false, { status: 'failed', statusAt: 1710000000 })).toEqual({
      label: 'claude',
      iconId: 'agent',
      contextValue: 'deck.terminal.foreign',
    });
  });
});
