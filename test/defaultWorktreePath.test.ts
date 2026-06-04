import { describe, expect, it } from 'vitest';
import { defaultWorktreePath } from '../src/worktree/defaultWorktreePath';

describe('defaultWorktreePath', () => {
  it('places new worktrees beside the main worktree using a safe branch slug', () => {
    expect(defaultWorktreePath('/work/myrepo', 'feature/foo')).toBe(
      '/work/myrepo-feature-foo',
    );
    expect(defaultWorktreePath('/work/myrepo', '...bug/fix!!!')).toBe(
      '/work/myrepo-bug-fix',
    );
    expect(defaultWorktreePath('/work/myrepo', 'féature/雪')).toBe(
      '/work/myrepo-feature',
    );
    expect(defaultWorktreePath('/work/myrepo/', 'bug/fix')).toBe(
      '/work/myrepo-bug-fix',
    );
  });
});
