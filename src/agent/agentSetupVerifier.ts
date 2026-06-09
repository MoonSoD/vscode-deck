import type { AgentName } from './agentTypes';
import type { AgentSidecar } from './snapshotRewriter';

interface SidecarReader {
  readAll(): Promise<ReadonlyMap<string, AgentSidecar>>;
}

interface Notifications {
  showInformationMessage(message: string): Thenable<string | undefined>;
  showWarningMessage(message: string): Thenable<string | undefined>;
}

interface AgentSetupVerifierOptions {
  sidecars: SidecarReader;
  notifications: Notifications;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

interface Disposable {
  dispose(): void;
}

export class AgentSetupVerifier {
  private readonly pollIntervalMs: number;
  private readonly timeoutMs: number;

  constructor(private readonly options: AgentSetupVerifierOptions) {
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  arm(): Disposable {
    let interval: NodeJS.Timeout | undefined;
    let timeout: NodeJS.Timeout | undefined;
    let done = false;

    const dispose = () => {
      if (interval) clearInterval(interval);
      if (timeout) clearTimeout(timeout);
    };
    const finish = (callback: () => void) => {
      if (done) return;
      done = true;
      dispose();
      callback();
    };
    const check = async () => {
      const sidecars = await this.options.sidecars.readAll();
      const firstSidecar = sidecars.values().next().value;
      if (firstSidecar) {
        finish(() => {
          void this.options.notifications.showInformationMessage(
            `Deck captured a ${agentLabel(firstSidecar.agent)} AgentSession. Agent resume is set up.`,
          );
        });
      }
    };

    interval = setInterval(() => {
      void check();
    }, this.pollIntervalMs);
    timeout = setTimeout(() => {
      finish(() => {
        void this.options.notifications.showWarningMessage(
          'Deck has not captured an AgentSession yet. Start or restart Claude/Codex in a Deck Terminal; if this message keeps appearing, agent hooks may not be working.',
        );
      });
    }, this.timeoutMs);
    void check();

    return { dispose };
  }
}

function agentLabel(agent: AgentName): string {
  return agent === 'claude' ? 'Claude' : 'Codex';
}
