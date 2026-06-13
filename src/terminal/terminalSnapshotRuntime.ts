import type { TerminalSnapshotRestoreFeedback } from './terminalSnapshotRestoreFeedback';

export interface TerminalSnapshotTmuxCli {
  runShell(scriptPath: string): Promise<void>;
  newAnchorSession(session: string, cwd: string): Promise<void>;
  killSession(session: string): Promise<void>;
}

export interface Disposable {
  dispose(): void;
}

export interface RestoreOutcome {
  restored: boolean;
}

export interface TerminalSnapshotWedgeRecovery {
  ensureHealthyServer(): Promise<{ started: boolean; recovered?: boolean }>;
}

export interface TerminalSnapshotSaveLock {
  acquire(): Promise<boolean>;
  release(): Promise<void>;
}

export const TERMINAL_SNAPSHOT_ANCHOR_SESSION = '__deck_anchor';

export class TerminalSnapshotRuntime {
  constructor(
    private readonly tmux: TerminalSnapshotTmuxCli,
    private readonly saveScriptPath: () => string,
    private readonly restoreScriptPath: () => string,
    private readonly anchorCwd: () => string,
    private readonly beforeRestore: () => Promise<void> = () => Promise.resolve(),
    private readonly wedgeRecovery?: TerminalSnapshotWedgeRecovery,
    private readonly restoreFeedback?: TerminalSnapshotRestoreFeedback,
    private readonly saveLock?: TerminalSnapshotSaveLock,
  ) {}

  async save(): Promise<void> {
    if (this.saveLock && !(await this.saveLock.acquire())) return;

    try {
      await this.tmux.runShell(this.saveScriptPath());
    } finally {
      await this.saveLock?.release();
    }
  }

  async restoreOnActivation(): Promise<RestoreOutcome> {
    try {
      // A prior activation that died between anchoring and cleanup leaves the
      // anchor behind; with `destroy-unattached off` it keeps an otherwise
      // empty server alive. Clear it before starting this restore attempt.
      await this.killAnchor();

      const server = await this.ensureHealthyServer();
      if (!server.started) return { restored: false };
      let restored = false;
      try {
        await this.withRestoreFeedback(Boolean(server.recovered), async () => {
          // Best-effort: a failed agent-session rewrite must never abort terminal
          // restore (ADR-0019). Log and restore regardless.
          await this.beforeRestore().catch((error) => {
            console.warn('Deck: agent-session snapshot rewrite failed; restoring without resume', error);
          });
          await this.tmux.runShell(this.restoreScriptPath());
          restored = true;
        });
      } catch (error) {
        console.warn('Deck: restoring TerminalSnapshot failed', error);
      } finally {
        await this.killAnchor();
      }
      return { restored };
    } catch (error) {
      console.warn('Deck: restoring TerminalSnapshot failed', error);
      return { restored: false };
    }
  }

  private async killAnchor(): Promise<void> {
    try {
      await this.tmux.killSession(TERMINAL_SNAPSHOT_ANCHOR_SESSION);
    } catch (error) {
      console.warn('Deck: removing TerminalSnapshot anchor failed', error);
    }
  }

  private async ensureHealthyServer(): Promise<{ started: boolean; recovered: boolean }> {
    if (this.wedgeRecovery) {
      const outcome = await this.wedgeRecovery.ensureHealthyServer();
      return { started: outcome.started, recovered: Boolean(outcome.recovered) };
    }

    await this.tmux.newAnchorSession(TERMINAL_SNAPSHOT_ANCHOR_SESSION, this.anchorCwd());
    return { started: true, recovered: false };
  }

  private async withRestoreFeedback(unresponsive: boolean, task: () => Promise<void>): Promise<void> {
    if (!this.restoreFeedback) {
      await task();
      return;
    }

    await this.restoreFeedback.withProgress({ unresponsive }, task);
  }

  startPeriodicSave(intervalMs: number): Disposable {
    const timer = setInterval(() => {
      void this.save().catch((error) => {
        console.warn('Deck: saving TerminalSnapshot failed', error);
      });
    }, intervalMs);

    return {
      dispose: () => clearInterval(timer),
    };
  }
}
