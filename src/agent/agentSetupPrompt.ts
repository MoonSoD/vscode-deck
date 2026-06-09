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

export class AgentSetupPrompt {
  constructor(private readonly deps: {
    detector: AgentDetector;
    installer: AgentHookInstaller;
    globalState: GlobalState;
    notifications: Notifications;
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
      `Deck can restore ${formatAgentList(agents)} agent sessions after reboot.`,
      setupAction,
      dontAskAgain,
    );
    if (action === dontAskAgain) {
      await this.deps.globalState.update(AGENT_HOOK_SETUP_DISMISSED_KEY, true);
      return;
    }
    if (action !== setupAction) return;

    const selected = agents.length === 1
      ? agents
      : (await this.deps.notifications.showQuickPick(
          agents.map((agent) => ({ label: agentLabel(agent), agent, picked: true })),
          { canPickMany: true, placeHolder: 'Select agents for Deck resume hooks' },
        ))?.map((item) => item.agent) ?? [];
    if (selected.length === 0) return;
    await this.deps.installer.install(selected);
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
