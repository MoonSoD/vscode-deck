import { describe, expect, it } from 'vitest';
import { branchWorktreeName, defaultWorktreePath } from '../src/worktree/defaultWorktreePath';

describe('defaultWorktreePath', () => {
  it('groups worktrees under <repo>.worktrees and slugs only the branch slashes', () => {
    expect(defaultWorktreePath('/work/myrepo', 'feature/foo')).toBe(
      '/work/myrepo.worktrees/feature-foo',
    );
    // Non-slash punctuation is preserved (matches VS Code, which trusts git ref rules).
    expect(defaultWorktreePath('/work/myrepo', 'fix-123')).toBe(
      '/work/myrepo.worktrees/fix-123',
    );
    // Non-ASCII characters are preserved — git accepts them, the filesystem accepts them.
    expect(defaultWorktreePath('/work/myrepo', 'féature/雪')).toBe(
      '/work/myrepo.worktrees/féature-雪',
    );
    // Trailing slash on the repo path is normalized away.
    expect(defaultWorktreePath('/work/myrepo/', 'bug/fix')).toBe(
      '/work/myrepo.worktrees/bug-fix',
    );
  });

  it('uses a remembered root when present', () => {
    expect(defaultWorktreePath('/work/myrepo', 'feature/foo', '/worktrees/myrepo')).toBe(
      '/worktrees/myrepo/feature-foo',
    );
    expect(branchWorktreeName('feature/foo')).toBe('feature-foo');
  });
});
