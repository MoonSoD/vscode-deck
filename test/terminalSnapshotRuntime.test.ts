import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalSnapshotRuntime } from '../src/terminal/terminalSnapshotRuntime';

class FakeTmux {
  readonly calls: string[] = [];
  serverRunning = false;
  runShellError: Error | undefined;

  async runShell(scriptPath: string): Promise<void> {
    this.calls.push(`runShell:${scriptPath}`);
    if (this.runShellError) throw this.runShellError;
  }

  async isServerRunning(): Promise<boolean> {
    this.calls.push('isServerRunning');
    return this.serverRunning;
  }

  async newAnchorSession(session: string, cwd: string): Promise<void> {
    this.calls.push(`newAnchorSession:${session}:${cwd}`);
  }

  async killSession(session: string): Promise<void> {
    this.calls.push(`killSession:${session}`);
  }
}

describe('TerminalSnapshotRuntime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves through run-shell with the current save script path', async () => {
    const tmux = new FakeTmux();
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => `/ext/resources/plugins/tmux-resurrect/scripts/save-${tmux.calls.length + 1}.sh`,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
    );

    await runtime.save();
    await runtime.save();

    expect(tmux.calls).toEqual([
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/save-1.sh',
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/save-2.sh',
    ]);
  });

  it('saves periodically until disposed', async () => {
    vi.useFakeTimers();
    const tmux = new FakeTmux();
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
    );

    const periodicSave = runtime.startPeriodicSave(300_000);

    await vi.advanceTimersByTimeAsync(299_999);
    expect(tmux.calls).toEqual([]);

    await vi.advanceTimersByTimeAsync(1);
    expect(tmux.calls).toEqual(['runShell:/ext/resources/plugins/tmux-resurrect/scripts/save.sh']);

    await vi.advanceTimersByTimeAsync(300_000);
    expect(tmux.calls).toEqual([
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
    ]);

    periodicSave.dispose();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(tmux.calls).toHaveLength(2);
  });

  it('restores on activation by anchoring a dead Deck socket', async () => {
    const tmux = new FakeTmux();
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
    );

    await expect(runtime.restoreOnActivation()).resolves.toEqual({ restored: true });

    expect(tmux.calls).toEqual([
      'isServerRunning',
      'newAnchorSession:__deck_anchor:/deck/global-storage',
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      'killSession:__deck_anchor',
    ]);
  });

  it('does not restore when the Deck socket is already running', async () => {
    const tmux = new FakeTmux();
    tmux.serverRunning = true;
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
    );

    await expect(runtime.restoreOnActivation()).resolves.toEqual({ restored: false });

    expect(tmux.calls).toEqual(['isServerRunning']);
  });

  it('kills the anchor and does not throw when restore fails', async () => {
    const tmux = new FakeTmux();
    tmux.runShellError = new Error('restore failed');
    const runtime = new TerminalSnapshotRuntime(
      tmux,
      () => '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      () => '/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      () => '/deck/global-storage',
    );

    await expect(runtime.restoreOnActivation()).resolves.toEqual({ restored: false });

    expect(tmux.calls).toEqual([
      'isServerRunning',
      'newAnchorSession:__deck_anchor:/deck/global-storage',
      'runShell:/ext/resources/plugins/tmux-resurrect/scripts/restore.sh',
      'killSession:__deck_anchor',
    ]);
  });
});
