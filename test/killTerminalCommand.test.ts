import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  closeTab: vi.fn(async () => true),
  tabGroups: [] as unknown[],
}));

vi.mock('vscode', () => ({
  window: {
    activeTerminal: undefined,
    tabGroups: {
      get all() {
        return vscodeState.tabGroups;
      },
      close: vscodeState.closeTab,
    },
  },
  commands: {
    executeCommand: vi.fn(),
  },
  Uri: {
    from(value: { scheme: string; authority?: string; path: string; query: string }) {
      return value;
    },
  },
}));

import { TerminalRemovalCommand } from '../src/terminal/killTerminalCommand';
import { TmuxCli, type CommandResult, type CommandRunner } from '../src/terminal/tmuxCli';

class MockRunner implements CommandRunner {
  constructor(private readonly result: CommandResult) {}

  async run(): Promise<CommandResult> {
    return this.result;
  }
}

describe('TerminalRemovalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.tabGroups = [];
  });

  it('kills the selected terminal session and refreshes the tree', async () => {
    const tmux = {
      killSession: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    await new TerminalRemovalCommand(
      tmux,
      refresh,
    ).run({ terminal: { sessionName: 'wt-_work_repo__term-1' } });

    expect(tmux.killSession).toHaveBeenCalledWith('wt-_work_repo__term-1');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('skips deletion when the confirmation is declined', async () => {
    const tmux = {
      killSession: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const confirm = vi.fn(async () => false);

    await new TerminalRemovalCommand(tmux, refresh, confirm).run({
      terminal: { sessionName: 'wt-_work_repo__term-1', windowName: 'zsh' },
    });

    expect(confirm).toHaveBeenCalledWith('zsh');
    expect(tmux.killSession).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('kills the session once the confirmation is accepted', async () => {
    const tmux = {
      killSession: vi.fn(async () => undefined),
    };
    const confirm = vi.fn(async () => true);

    await new TerminalRemovalCommand(tmux, vi.fn(), confirm).run({
      terminal: { sessionName: 'wt-_work_repo__term-1', windowName: 'claude' },
    });

    expect(confirm).toHaveBeenCalledWith('claude');
    expect(tmux.killSession).toHaveBeenCalledWith('wt-_work_repo__term-1');
  });

  it('no-ops on a non-Terminal selection (Worktree/Repository row)', async () => {
    const tmux = {
      killSession: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();

    await new TerminalRemovalCommand(tmux, refresh).run(
      { worktree: { path: '/work/repo' } } as never,
    );

    expect(tmux.killSession).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('is idempotent when closing the same stale row twice', async () => {
    const tmux = {
      killSession: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new TerminalRemovalCommand(tmux, refresh);
    const node = { terminal: { sessionName: 'wt-_work_repo__term-1' } };

    await command.run(node);
    await command.run(node);

    expect(tmux.killSession).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('closes the matching Deck custom-editor tab after killing the session', async () => {
    const tmux = {
      killSession: vi.fn(async () => undefined),
    };
    const tab = {
      input: {
        viewType: 'deck.terminal',
        uri: {
          scheme: 'deck-terminal',
          path: '/work/repo/term-1',
        },
      },
    };
    vscodeState.tabGroups = [{ tabs: [tab] }];

    await new TerminalRemovalCommand(
      tmux,
      vi.fn(),
    ).run({ terminal: { sessionName: 'wt-_work_repo__term-1' } });

    expect(vscodeState.closeTab).toHaveBeenCalledWith(tab);
    expect(vscodeState.closeTab.mock.invocationCallOrder[0]).toBeGreaterThan(
      tmux.killSession.mock.invocationCallOrder[0],
    );
  });

  it('survives a missing tmux server', async () => {
    const tmux = new TmuxCli(
      '/ext/resources/deck.conf',
      new MockRunner({ code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-1000/deck' }),
    );
    const refresh = vi.fn();

    await expect(
      new TerminalRemovalCommand(
        tmux,
        refresh,
      ).run({
        terminal: { sessionName: 'wt-_work_repo__term-1' },
      }),
    ).resolves.toBeUndefined();

    expect(refresh).toHaveBeenCalledOnce();
  });
});
