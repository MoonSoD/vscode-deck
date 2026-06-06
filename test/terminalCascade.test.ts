import { describe, expect, it, vi } from 'vitest';
import { TerminalCascade } from '../src/terminal/terminalCascade';

describe('TerminalCascade', () => {
  it('kills only sessions matching the removed Worktree prefix', async () => {
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_repo_feature__term-1', windowName: 'zsh' },
        { sessionName: 'wt-_repo_feature__term-2', windowName: 'claude' },
        { sessionName: 'wt-_repo_other__term-1', windowName: 'zsh' },
      ]),
      killSession: vi.fn(async () => undefined),
    };
    const cascade = new TerminalCascade(tmux);

    await cascade.killWorktree('/repo/feature');

    expect(tmux.killSession).toHaveBeenCalledTimes(2);
    expect(tmux.killSession).toHaveBeenNthCalledWith(1, 'wt-_repo_feature__term-1');
    expect(tmux.killSession).toHaveBeenNthCalledWith(2, 'wt-_repo_feature__term-2');
  });

  it('swallows kill failures and continues killing matching sessions', async () => {
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_repo_feature__term-1', windowName: 'zsh' },
        { sessionName: 'wt-_repo_feature__term-2', windowName: 'claude' },
      ]),
      killSession: vi
        .fn()
        .mockRejectedValueOnce(new Error('session not found'))
        .mockResolvedValueOnce(undefined),
    };
    const cascade = new TerminalCascade(tmux);

    await expect(cascade.killWorktree('/repo/feature')).resolves.toBeUndefined();

    expect(tmux.killSession).toHaveBeenCalledTimes(2);
  });
});
