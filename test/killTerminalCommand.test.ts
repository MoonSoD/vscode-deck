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

import { CloseTerminalCommand } from '../src/terminal/killTerminalCommand';
import { TmuxCli, type CommandResult, type CommandRunner } from '../src/terminal/tmuxCli';

class MockRunner implements CommandRunner {
  constructor(private readonly result: CommandResult) {}

  async run(): Promise<CommandResult> {
    return this.result;
  }
}

describe('CloseTerminalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.tabGroups = [];
  });

  it('kills the selected terminal session and refreshes the tree', async () => {
    const tmux = {
      killSession: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    await new CloseTerminalCommand(
      tmux,
      refresh,
    ).run({ terminal: { sessionName: 'wt-_work_repo__term-1' } });

    expect(tmux.killSession).toHaveBeenCalledWith('wt-_work_repo__term-1');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('is idempotent when closing the same stale row twice', async () => {
    const tmux = {
      killSession: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const command = new CloseTerminalCommand(tmux, refresh);
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

    await new CloseTerminalCommand(
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
      new CloseTerminalCommand(
        tmux,
        refresh,
      ).run({
        terminal: { sessionName: 'wt-_work_repo__term-1' },
      }),
    ).resolves.toBeUndefined();

    expect(refresh).toHaveBeenCalledOnce();
  });
});
