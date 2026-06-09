import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalSnapshotRuntime } from '../src/terminal/terminalSnapshotRuntime';

describe('TerminalSnapshotRuntime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves through run-shell with the current save script path', async () => {
    const runShellCalls: string[] = [];
    const runtime = new TerminalSnapshotRuntime(
      { runShell: async (scriptPath) => { runShellCalls.push(scriptPath); } },
      () => `/ext/resources/plugins/tmux-resurrect/scripts/save-${runShellCalls.length + 1}.sh`,
    );

    await runtime.save();
    await runtime.save();

    expect(runShellCalls).toEqual([
      '/ext/resources/plugins/tmux-resurrect/scripts/save-1.sh',
      '/ext/resources/plugins/tmux-resurrect/scripts/save-2.sh',
    ]);
  });

  it('saves periodically until disposed', async () => {
    vi.useFakeTimers();
    const runShellCalls: string[] = [];
    const runtime = new TerminalSnapshotRuntime(
      { runShell: async (scriptPath) => { runShellCalls.push(scriptPath); } },
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
    );

    const periodicSave = runtime.startPeriodicSave(300_000);

    await vi.advanceTimersByTimeAsync(299_999);
    expect(runShellCalls).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(runShellCalls).toEqual(['/ext/resources/plugins/tmux-resurrect/scripts/save.sh']);

    await vi.advanceTimersByTimeAsync(300_000);
    expect(runShellCalls).toEqual([
      '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
    ]);

    periodicSave.dispose();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(runShellCalls).toHaveLength(2);
  });
});
