import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    activeTerminal: undefined,
  },
  commands: {
    executeCommand: vi.fn(),
  },
}));

import { CloseTerminalCommand } from '../src/terminal/killTerminalCommand';
import { TerminalSessionRegistry } from '../src/terminal/terminalSessionRegistry';
import { TmuxCli, type CommandResult, type CommandRunner } from '../src/terminal/tmuxCli';

class MockRunner implements CommandRunner {
  constructor(private readonly result: CommandResult) {}

  async run(): Promise<CommandResult> {
    return this.result;
  }
}

describe('CloseTerminalCommand', () => {
  it('kills the selected terminal session, disposes the editor terminal, and refreshes the tree', async () => {
    const tmux = {
      killSession: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const terminalSessionListCache = {
      removeSession: vi.fn(async () => undefined),
    };
    const pidStore = {
      remove: vi.fn(async () => undefined),
    };
    const registry = new TerminalSessionRegistry();
    const terminal = { show: vi.fn(), dispose: vi.fn() };
    registry.set('wt-_work_repo__term-1', terminal);

    await new CloseTerminalCommand(
      tmux,
      registry,
      refresh,
      terminalSessionListCache,
      pidStore,
    ).run({ terminal: { sessionName: 'wt-_work_repo__term-1' } });

    expect(tmux.killSession).toHaveBeenCalledWith('wt-_work_repo__term-1');
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(terminalSessionListCache.removeSession).toHaveBeenCalledWith('wt-_work_repo__term-1');
    expect(pidStore.remove).toHaveBeenCalledWith('wt-_work_repo__term-1');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('is idempotent when closing the same stale row twice', async () => {
    const tmux = {
      killSession: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const terminalSessionListCache = {
      removeSession: vi.fn(async () => undefined),
    };
    const registry = new TerminalSessionRegistry();
    const terminal = { show: vi.fn(), dispose: vi.fn() };
    registry.set('wt-_work_repo__term-1', terminal);
    const command = new CloseTerminalCommand(tmux, registry, refresh, terminalSessionListCache);
    const node = { terminal: { sessionName: 'wt-_work_repo__term-1' } };

    await command.run(node);
    await command.run(node);

    expect(tmux.killSession).toHaveBeenCalledTimes(2);
    expect(terminal.dispose).toHaveBeenCalledOnce();
    expect(terminalSessionListCache.removeSession).toHaveBeenCalledTimes(2);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('survives a missing tmux server', async () => {
    const tmux = new TmuxCli(
      '/ext/resources/deck.conf',
      new MockRunner({ code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-1000/deck' }),
    );
    const refresh = vi.fn();
    const terminalSessionListCache = {
      removeSession: vi.fn(async () => undefined),
    };

    await expect(
      new CloseTerminalCommand(
        tmux,
        new TerminalSessionRegistry(),
        refresh,
        terminalSessionListCache,
      ).run({
        terminal: { sessionName: 'wt-_work_repo__term-1' },
      }),
    ).resolves.toBeUndefined();

    expect(terminalSessionListCache.removeSession).toHaveBeenCalledWith('wt-_work_repo__term-1');
    expect(refresh).toHaveBeenCalledOnce();
  });
});
