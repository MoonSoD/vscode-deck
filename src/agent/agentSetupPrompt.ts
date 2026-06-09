import type { AgentName, DetectedAgent } from './agentTypes';
import { NotificationGate } from './notificationGate';

export const AGENT_HOOK_SETUP_DISMISSED_KEY = 'deck.agentHooks.setup.dismissed';

interface GlobalState {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

interface AgentDetector {
  detect(): Promise<DetectedAgent[]>;
}

interface AgentHookInstaller {
  isInstalled(agent: AgentName): Promise<boolean>;
  install(agents: readonly AgentName[]): Promise<void>;
}

interface AgentPick {
  label: string;
  agent: AgentName;
  picked: boolean;
}

interface Notifications {
  showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
  showQuickPick(
    items: readonly AgentPick[],
    options: { canPickMany: true; placeHolder: string },
  ): Thenable<readonly AgentPick[] | undefined>;
}

interface AgentSetupVerifier {
  arm(): void;
}

export interface AgentConfigChange {
  agent: AgentName;
  configPath: string;
}

interface AgentSetupReviewer {
  showChanges(configs: readonly AgentConfigChange[]): Promise<void>;
}

export class AgentSetupPrompt {
  constructor(private readonly deps: {
    detector: AgentDetector;
    installer: AgentHookInstaller;
    globalState: GlobalState;
    notifications: Notifications;
    verifier?: AgentSetupVerifier;
    reviewer?: AgentSetupReviewer;
  }) {}

  async run(options: { ignoreDismissal?: boolean } = {}): Promise<void> {
    const detected = await this.deps.detector.detect();
    const installed = await this.installedAgents(detected);
    const agents = NotificationGate.shouldPrompt({
      detected,
      installed,
      dismissed: !options.ignoreDismissal && this.deps.globalState.get(AGENT_HOOK_SETUP_DISMISSED_KEY, false),
    });
    if (agents.length === 0) return;

    const setupAction = `Set Up ${formatAgentList(agents)}`;
    const dontAskAgain = "Don't ask again";
    const action = await this.deps.notifications.showInformationMessage(
      `Deck can restore ${formatAgentList(agents)} agent sessions after reboot. Each config is backed up first; undo anytime with "Deck: Remove agent hooks".`,
      setupAction,
      dontAskAgain,
    );
    if (action === dontAskAgain) {
      await this.deps.globalState.update(AGENT_HOOK_SETUP_DISMISSED_KEY, true);
      return;
    }
    if (action !== setupAction) return;

    const selected = await this.selectAgentsToInstall(agents);
    if (selected.length === 0) return;

    await this.deps.installer.install(selected);
    this.deps.verifier?.arm();

    // Review happens *after* the (backed-up, one-command-undoable) write: a
    // native diff of the backup against the modified file, instead of a modal
    // that can't scroll and would echo the user's secrets back at them.
    const reviewChanges = 'Review changes';
    const choice = await this.deps.notifications.showInformationMessage(
      `Resume hooks installed for ${formatAgentList(selected)}. Already-running agents must be restarted before Deck can track them.`,
      reviewChanges,
    );
    if (choice === reviewChanges) {
      await this.deps.reviewer?.showChanges(this.changesFor(selected, detected));
    }
  }

  private changesFor(
    selected: readonly AgentName[],
    detected: readonly DetectedAgent[],
  ): AgentConfigChange[] {
    return selected.flatMap((agent) => {
      const match = detected.find((candidate) => candidate.agent === agent);
      return match ? [{ agent, configPath: match.configPath }] : [];
    });
  }

  private async selectAgentsToInstall(agents: readonly AgentName[]): Promise<readonly AgentName[]> {
    if (agents.length === 1) return agents;

    const selected = await this.deps.notifications.showQuickPick(
      agents.map((agent) => ({ label: agentLabel(agent), agent, picked: true })),
      { canPickMany: true, placeHolder: 'Select agents for Deck resume hooks' },
    );
    return selected?.map((item) => item.agent) ?? [];
  }

  private async installedAgents(detected: readonly DetectedAgent[]): Promise<Set<AgentName>> {
    const installed = new Set<AgentName>();
    await Promise.all(detected.map(async ({ agent }) => {
      if (await this.deps.installer.isInstalled(agent)) installed.add(agent);
    }));
    return installed;
  }
}

function formatAgentList(agents: readonly AgentName[]): string {
  const labels = agents.map(agentLabel);
  if (labels.length <= 2) return labels.join(' and ');
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

function agentLabel(agent: AgentName): string {
  return agent === 'claude' ? 'Claude' : 'Codex';
}
