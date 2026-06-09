export interface TerminalSnapshotTmuxCli {
  runShell(scriptPath: string): Promise<void>;
}

export interface Disposable {
  dispose(): void;
}

export class TerminalSnapshotRuntime {
  constructor(
    private readonly tmux: TerminalSnapshotTmuxCli,
    private readonly saveScriptPath: () => string,
  ) {}

  async save(): Promise<void> {
    await this.tmux.runShell(this.saveScriptPath());
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
