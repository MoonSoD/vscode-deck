import type { AgentName, DetectedAgent } from './agentTypes';
import { NotificationGate } from './notificationGate';

export const AGENT_HOOK_SETUP_DISMISSED_KEY = 'deck.agentHooks.setup.dismissed';

const ALL_AGENTS: readonly AgentName[] = ['claude', 'codex'];

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
  remove(agents: readonly AgentName[]): Promise<AgentName[]>;
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
    reviewer?: AgentSetupReviewer;
  }) {}

  // `explicit` = the user ran the "Install agent hooks" command. They've already
  // expressed intent, so we skip the offer notification (and its "Don't ask
  // again"), report empty states rather than doing nothing, and clear any prior
  // dismissal so the activation offer can resurface for agents added later. The
  // passive activation nudge (`run()`) keeps the offer.
  async run(options: { explicit?: boolean } = {}): Promise<void> {
    const explicit = options.explicit ?? false;
    if (explicit) await this.deps.globalState.update(AGENT_HOOK_SETUP_DISMISSED_KEY, false);

    const detected = await this.deps.detector.detect();
    const installed = await this.installedAgents(detected);
    const agents = NotificationGate.shouldPrompt({
      detected,
      installed,
      dismissed: !explicit && this.deps.globalState.get(AGENT_HOOK_SETUP_DISMISSED_KEY, false),
    });

    if (agents.length === 0) {
      if (explicit) await this.reportNothingToInstall(detected);
      return;
    }

    if (!explicit && !(await this.offerSetup(agents))) return;

    const selected = await this.pickAgents(agents, 'Select agents for Deck resume hooks');
    if (selected.length === 0) return;

    await this.deps.installer.install(selected);
    await this.offerReview(selected, detected);
  }

  // Mirrors install: offer the *installed* agents (quick-pick when more than one),
  // remove the selected ones, report what changed. Uninstall never sets the
  // dismissal — suppression is only ever an explicit user choice ("Don't ask
  // again") — so after removing an agent the activation offer can resurface it.
  async uninstall(): Promise<void> {
    const installed = await this.installedAgentList();
    if (installed.length === 0) {
      await this.deps.notifications.showInformationMessage('No Deck agent hooks are installed.');
      return;
    }

    const selected = await this.pickAgents(installed, 'Select agents to remove Deck resume hooks from');
    if (selected.length === 0) return;

    const removed = await this.deps.installer.remove(selected);
    await this.deps.notifications.showInformationMessage(
      removed.length > 0
        ? `Removed Deck agent hooks for ${formatAgentList(removed)}. Your other hooks are untouched.`
        : 'No Deck agent hooks were removed.',
    );
  }

  private async offerSetup(agents: readonly AgentName[]): Promise<boolean> {
    const setupAction = `Set Up ${formatAgentList(agents)}`;
    const dontAskAgain = "Don't ask again";
    const action = await this.deps.notifications.showInformationMessage(
      `Deck can restore ${formatAgentList(agents)} agent sessions after reboot. Each config is backed up first; undo anytime with "Deck: Uninstall agent hooks".`,
      setupAction,
      dontAskAgain,
    );
    if (action === dontAskAgain) {
      await this.deps.globalState.update(AGENT_HOOK_SETUP_DISMISSED_KEY, true);
      return false;
    }
    return action === setupAction;
  }

  private async reportNothingToInstall(detected: readonly DetectedAgent[]): Promise<void> {
    const message = detected.length === 0
      ? 'No Claude or Codex installation detected.'
      : `Deck resume hooks are already installed for ${formatAgentList(detected.map((agent) => agent.agent))}.`;
    await this.deps.notifications.showInformationMessage(message);
  }

  private async offerReview(
    selected: readonly AgentName[],
    detected: readonly DetectedAgent[],
  ): Promise<void> {
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

  private async pickAgents(
    agents: readonly AgentName[],
    placeHolder: string,
  ): Promise<readonly AgentName[]> {
    if (agents.length === 1) return agents;

    const selected = await this.deps.notifications.showQuickPick(
      agents.map((agent) => ({ label: agentLabel(agent), agent, picked: true })),
      { canPickMany: true, placeHolder },
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

  private async installedAgentList(): Promise<AgentName[]> {
    const installed: AgentName[] = [];
    for (const agent of ALL_AGENTS) {
      if (await this.deps.installer.isInstalled(agent)) installed.push(agent);
    }
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
