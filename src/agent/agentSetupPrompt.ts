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
  preview(agents: readonly AgentName[]): Promise<Array<{
    agent: AgentName;
    configPath: string;
    contents: string;
  }>>;
  install(agents: readonly AgentName[]): Promise<void>;
}

interface AgentPick {
  label: string;
  agent: AgentName;
  picked: boolean;
}

interface Notifications {
  showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
  showInformationMessage(
    message: string,
    options: { modal: true; detail: string },
    ...items: string[]
  ): Thenable<string | undefined>;
  showQuickPick(
    items: readonly AgentPick[],
    options: { canPickMany: true; placeHolder: string },
  ): Thenable<readonly AgentPick[] | undefined>;
}

interface AgentSetupVerifier {
  arm(): void;
}

export class AgentSetupPrompt {
  constructor(private readonly deps: {
    detector: AgentDetector;
    installer: AgentHookInstaller;
    globalState: GlobalState;
    notifications: Notifications;
    verifier?: AgentSetupVerifier;
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

    const selected = await this.selectAgentsToInstall(agents);
    if (selected.length === 0) return;
    if (!await this.confirmPreview(selected)) return;
    await this.deps.installer.install(selected);
    this.deps.verifier?.arm();
  }

  private async confirmPreview(agents: readonly AgentName[]): Promise<boolean> {
    const previews = await this.deps.installer.preview(agents);
    const action = await this.deps.notifications.showInformationMessage(
      'Review Deck agent hook setup',
      { modal: true, detail: previewMessage(previews) },
      'Install Hooks',
      'Cancel',
    );
    return action === 'Install Hooks';
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

function previewMessage(previews: ReadonlyArray<{
  agent: AgentName;
  configPath: string;
  contents: string;
}>): string {
  const lines = [
    previews.length === 1
      ? 'Deck will write this agent hook config change:'
      : 'Deck will write these agent hook config changes:',
    '',
  ];
  for (const preview of previews) {
    lines.push(`${agentLabel(preview.agent)}: ${preview.configPath}`);
    lines.push(preview.contents);
  }
  lines.push('Agents already running must be restarted before Deck can track them.');
  return lines.join('\n');
}
