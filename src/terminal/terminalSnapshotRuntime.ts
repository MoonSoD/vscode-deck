export interface TerminalSnapshotTmuxCli {
  runShell(scriptPath: string): Promise<void>;
  isServerRunning(): Promise<boolean>;
  newAnchorSession(session: string, cwd: string): Promise<void>;
  killSession(session: string): Promise<void>;
}

export interface Disposable {
  dispose(): void;
}

export interface RestoreOutcome {
  restored: boolean;
}

const ANCHOR_SESSION = '__deck_anchor';

export class TerminalSnapshotRuntime {
  constructor(
    private readonly tmux: TerminalSnapshotTmuxCli,
    private readonly saveScriptPath: () => string,
    private readonly restoreScriptPath: () => string,
    private readonly anchorCwd: () => string,
    private readonly beforeRestore: () => Promise<void> = () => Promise.resolve(),
  ) {}

  async save(): Promise<void> {
    await this.tmux.runShell(this.saveScriptPath());
  }

  async restoreOnActivation(): Promise<RestoreOutcome> {
    try {
      // A prior activation that died between anchoring and cleanup leaves the
      // anchor behind; with `destroy-unattached off` it keeps an otherwise
      // empty server alive, so `isServerRunning` would report true and every
      // future activation would skip restore. Clear it first so a stale anchor
      // can't masquerade as a live server.
      await this.killAnchor();

      if (await this.tmux.isServerRunning()) return { restored: false };

      await this.tmux.newAnchorSession(ANCHOR_SESSION, this.anchorCwd());
      let restored = false;
      try {
        // Best-effort: a failed agent-session rewrite must never abort terminal
        // restore (ADR-0019). Log and restore regardless.
        await this.beforeRestore().catch((error) => {
          console.warn('Deck: agent-session snapshot rewrite failed; restoring without resume', error);
        });
        await this.tmux.runShell(this.restoreScriptPath());
        restored = true;
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
      await this.tmux.killSession(ANCHOR_SESSION);
    } catch (error) {
      console.warn('Deck: removing TerminalSnapshot anchor failed', error);
    }
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
