import { describe, expect, it, vi } from 'vitest';
import { KillTerminalCommand } from '../src/terminal/killTerminalCommand';

describe('KillTerminalCommand', () => {
  it('kills the selected terminal session and refreshes the tree', async () => {
    const tmux = {
      killSession: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();

    await new KillTerminalCommand(tmux, refresh).run({
      terminal: { sessionName: 'wt-_work_repo__term-1' },
    });

    expect(tmux.killSession).toHaveBeenCalledWith('wt-_work_repo__term-1');
    expect(refresh).toHaveBeenCalledOnce();
  });
});
