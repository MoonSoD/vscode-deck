import { describe, expect, it } from 'vitest';
import {
  allocateTermN,
  terminalSessionName,
  terminalSessionPrefix,
  terminalWorktreePrefix,
  tmuxSafe,
} from '../src/terminal/tmuxSafe';

describe('tmuxSafe', () => {
  it('replaces tmux-unsafe path characters and is idempotent', () => {
    const once = tmuxSafe('/work/repo:feature.branch');

    expect(once).toBe('_work_repo_feature_branch');
    expect(tmuxSafe(once)).toBe(once);
  });

  it('builds Deck terminal session names from sanitized worktree paths', () => {
    expect(terminalSessionName('/work/repo.feature', 1)).toBe(
      'wt-_work_repo_feature__term-1',
    );
    expect(terminalWorktreePrefix('/work/repo.feature')).toBe('wt-_work_repo_feature__');
    expect(terminalSessionPrefix('/work/repo.feature')).toBe('wt-_work_repo_feature__term-');
  });

  it.each([
    ['empty input', [], 1],
    ['contiguous input', ['wt-_work_repo__term-1', 'wt-_work_repo__term-2'], 3],
    ['input with gaps', ['wt-_work_repo__term-1', 'wt-_work_repo__term-3'], 4],
    ['non-term session names', ['wt-_work_repo__term-1', 'wt-_work_repo__term-x', 'other'], 2],
  ])('allocates the next terminal number from %s', (_name, sessions, expected) => {
    expect(allocateTermN('/work/repo', sessions)).toBe(expected);
  });
});
