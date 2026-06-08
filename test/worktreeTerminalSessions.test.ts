import { describe, expect, it } from 'vitest';
import { groupTerminalSessionsByWorktree } from '../src/terminal/worktreeTerminalSessions';

describe('groupTerminalSessionsByWorktree', () => {
  it('returns an empty bucket for Worktrees with no sessions', () => {
    expect(groupTerminalSessionsByWorktree(['/work/repo'], [])).toEqual(
      new Map([['/work/repo', []]]),
    );
  });

  it('groups sessions for several Worktrees', () => {
    const sessions = [
      { sessionName: 'wt-_work_alpha__term-2', windowName: 'claude' },
      { sessionName: 'wt-_work_beta__term-1', windowName: 'zsh' },
      { sessionName: 'wt-_work_alpha__term-1', windowName: 'zsh' },
    ];

    expect(groupTerminalSessionsByWorktree(['/work/alpha', '/work/beta'], sessions)).toEqual(
      new Map([
        [
          '/work/alpha',
          [
            { sessionName: 'wt-_work_alpha__term-1', n: 1, windowName: 'zsh' },
            { sessionName: 'wt-_work_alpha__term-2', n: 2, windowName: 'claude' },
          ],
        ],
        [
          '/work/beta',
          [{ sessionName: 'wt-_work_beta__term-1', n: 1, windowName: 'zsh' }],
        ],
      ]),
    );
  });

  it('does not leak sessions across Worktrees with similar paths', () => {
    const sessions = [
      { sessionName: 'wt-_work_repo__term-1', windowName: 'repo' },
      { sessionName: 'wt-_work_repo_feature__term-1', windowName: 'feature' },
    ];

    expect(groupTerminalSessionsByWorktree(['/work/repo', '/work/repo.feature'], sessions)).toEqual(
      new Map([
        [
          '/work/repo',
          [{ sessionName: 'wt-_work_repo__term-1', n: 1, windowName: 'repo' }],
        ],
        [
          '/work/repo.feature',
          [{ sessionName: 'wt-_work_repo_feature__term-1', n: 1, windowName: 'feature' }],
        ],
      ]),
    );
  });
});
