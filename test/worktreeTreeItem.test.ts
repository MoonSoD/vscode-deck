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

describe('describeTerminalTreeItem', () => {
  it('renders in-progress agent status as a blue loading row', () => {
    expect(describeTerminalTreeItem('claude', false, { status: 'inProgress', statusAt: 1710000000 })).toEqual({
      label: 'claude',
      description: 'Working...',
      iconId: 'loading~spin',
      iconColorId: 'textLink.foreground',
      contextValue: 'deck.terminal.foreign',
    });
  });

  it('renders needs-input agent status as a warning filled dot', () => {
    expect(describeTerminalTreeItem('claude', false, { status: 'needsInput', statusAt: 1710000000 })).toEqual({
      label: 'claude',
      description: 'Input needed.',
      iconId: 'circle-filled',
      iconColorId: 'list.warningForeground',
      contextValue: 'deck.terminal.foreign',
    });
  });

  it('renders unread completed agent status as a blue filled dot', () => {
    expect(describeTerminalTreeItem('claude', false, {
      status: 'completed',
      statusAt: 1710000000,
      unread: true,
    })).toEqual({
      label: 'claude',
      iconId: 'circle-filled',
      iconColorId: 'textLink.foreground',
      contextValue: 'deck.terminal.foreign',
    });
  });

  it('renders read completed agent status as a muted small dot', () => {
    expect(describeTerminalTreeItem('claude', false, {
      status: 'completed',
      statusAt: 1710000000,
      unread: false,
    })).toEqual({
      label: 'claude',
      iconId: 'circle-small-filled',
      contextValue: 'deck.terminal.foreign',
    });
  });

  it('renders failed agent status as a red error icon', () => {
    expect(describeTerminalTreeItem('claude', false, { status: 'failed', statusAt: 1710000000 })).toEqual({
      label: 'claude',
      description: 'Failed',
      iconId: 'error',
      iconColorId: 'errorForeground',
      contextValue: 'deck.terminal.foreign',
    });
  });
});
