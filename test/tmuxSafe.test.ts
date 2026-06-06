import { describe, expect, it } from 'vitest';
import {
  allocateTermN,
  terminalSessionName,
  terminalSessionPrefix,
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
    expect(terminalSessionPrefix('/work/repo.feature')).toBe('wt-_work_repo_feature__term-');
  });

  it('allocates the next terminal number from existing session names', () => {
    expect(
      allocateTermN('/work/repo', [
        'wt-_work_repo__term-1',
        'wt-_work_repo__term-3',
        'wt-_work_other__term-9',
        'not-a-deck-terminal',
      ]),
    ).toBe(4);
    expect(allocateTermN('/work/repo', [])).toBe(1);
  });
});
