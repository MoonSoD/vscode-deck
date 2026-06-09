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

export class TerminalSnapshotRuntime {
  constructor(
    private readonly tmux: TerminalSnapshotTmuxCli,
    private readonly saveScriptPath: () => string,
    private readonly restoreScriptPath: () => string,
    private readonly anchorCwd: () => string,
  ) {}

  async save(): Promise<void> {
    await this.tmux.runShell(this.saveScriptPath());
  }

  async restoreOnActivation(): Promise<RestoreOutcome> {
    try {
      if (await this.tmux.isServerRunning()) return { restored: false };

      await this.tmux.newAnchorSession('__deck_anchor', this.anchorCwd());
      let restored = false;
      try {
        await this.tmux.runShell(this.restoreScriptPath());
        restored = true;
      } catch (error) {
        console.warn('Deck: restoring TerminalSnapshot failed', error);
      } finally {
        try {
          await this.tmux.killSession('__deck_anchor');
        } catch (error) {
          console.warn('Deck: removing TerminalSnapshot anchor failed', error);
        }
      }
      return { restored };
    } catch (error) {
      console.warn('Deck: restoring TerminalSnapshot failed', error);
      return { restored: false };
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
