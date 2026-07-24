import { describe, expect, it } from 'vitest';
import { worktreeForCwd } from '../src/chat/chatSessionWorktree';

describe('worktreeForCwd', () => {
  it('matches a cwd that is exactly a worktree path', () => {
    expect(worktreeForCwd('/work/alpha', ['/work/alpha', '/work/beta'])).toBe('/work/alpha');
  });

  it('matches a cwd nested inside a worktree', () => {
    expect(worktreeForCwd('/work/alpha/plugins/x', ['/work/alpha'])).toBe('/work/alpha');
  });

  it('does not match on a bare string prefix without a path boundary', () => {
    expect(worktreeForCwd('/work/frontend-e2e/src', ['/work/frontend', '/work/frontend-e2e'])).toBe(
      '/work/frontend-e2e',
    );
  });

  it('picks the longest matching worktree when several contain the cwd', () => {
    expect(worktreeForCwd('/work/a/b/c', ['/work/a', '/work/a/b'])).toBe('/work/a/b');
  });

  it('returns undefined when no worktree contains the cwd', () => {
    expect(worktreeForCwd('/elsewhere', ['/work/a'])).toBeUndefined();
  });
});
