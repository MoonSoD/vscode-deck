import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  closeTab: vi.fn(async () => true),
  tabGroups: [] as unknown[],
}));

vi.mock('vscode', () => ({
  window: {
    tabGroups: {
      get all() {
        return vscodeState.tabGroups;
      },
      close: vscodeState.closeTab,
    },
  },
}));

import { TerminalCascade } from '../src/terminal/terminalCascade';

describe('TerminalCascade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.tabGroups = [];
  });

  it('kills only sessions matching the removed Worktree prefix', async () => {
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_repo_feature__term-1', windowName: 'zsh' },
        { sessionName: 'wt-_repo_feature__term-2', windowName: 'claude' },
        { sessionName: 'wt-_repo_other__term-1', windowName: 'zsh' },
      ]),
      killSession: vi.fn(async () => undefined),
    };
    const onSessionKilled = vi.fn(async () => undefined);
    const cascade = new TerminalCascade(tmux, undefined, onSessionKilled);

    await cascade.killWorktree('/repo/feature');

    expect(tmux.killSession).toHaveBeenCalledTimes(2);
    expect(tmux.killSession).toHaveBeenNthCalledWith(1, 'wt-_repo_feature__term-1');
    expect(tmux.killSession).toHaveBeenNthCalledWith(2, 'wt-_repo_feature__term-2');
    expect(onSessionKilled).toHaveBeenCalledTimes(2);
    expect(onSessionKilled).toHaveBeenNthCalledWith(1, 'wt-_repo_feature__term-1');
    expect(onSessionKilled).toHaveBeenNthCalledWith(2, 'wt-_repo_feature__term-2');
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

  it('kills sessions before closing matching custom-editor tabs only', async () => {
    const tmux = {
      listSessions: vi.fn(async () => [
        { sessionName: 'wt-_repo_feature__term-1', windowName: 'zsh' },
        { sessionName: 'wt-_repo_feature__term-2', windowName: 'claude' },
        { sessionName: 'wt-_repo_other__term-1', windowName: 'zsh' },
      ]),
      killSession: vi.fn(async () => undefined),
    };
    const matchingTab = {
      input: {
        viewType: 'deck.terminal',
        uri: {
          scheme: 'deck-terminal',
          path: '/repo/feature/term-1',
        },
      },
    };
    const otherTab = {
      input: {
        viewType: 'deck.terminal',
        uri: {
          scheme: 'deck-terminal',
          path: '/repo/other/term-1',
        },
      },
    };
    vscodeState.tabGroups = [{ tabs: [matchingTab, otherTab] }];
    const cascade = new TerminalCascade(tmux);

    await cascade.killWorktree('/repo/feature');

    expect(tmux.killSession).toHaveBeenCalledTimes(2);
    expect(vscodeState.closeTab).toHaveBeenCalledWith(matchingTab);
    expect(vscodeState.closeTab).not.toHaveBeenCalledWith(otherTab);
    expect(vscodeState.closeTab.mock.invocationCallOrder[0]).toBeGreaterThan(
      tmux.killSession.mock.invocationCallOrder[1],
    );
  });
});
