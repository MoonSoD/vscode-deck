import { describe, expect, it, vi } from 'vitest';
import { AGENT_HOOK_SETUP_DISMISSED_KEY, AgentSetupPrompt } from '../src/agent/agentSetupPrompt';
import type { AgentName } from '../src/agent/agentTypes';

describe('AgentSetupPrompt', () => {
  it('shows no notification when no agent is detected', async () => {
    const prompt = createPrompt({ detected: [] });

    await prompt.run();

    expect(prompt.notifications.showInformationMessage).not.toHaveBeenCalled();
  });

  it('offers only detected uninstalled agents and installs them', async () => {
    const prompt = createPrompt({
      detected: [
        { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
        { agent: 'codex', configPath: '/home/me/.codex/hooks.json' },
      ],
      currentInstalls: new Set(['claude']),
      infoChoices: ['Set Up Codex'],
    });

    await prompt.run();

    expect(prompt.notifications.showQuickPick).not.toHaveBeenCalled();
    expect(prompt.installer.install).toHaveBeenCalledWith(['codex']);
  });

  it('installs without a blocking modal preview', async () => {
    const prompt = createPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      infoChoices: ['Set Up Claude'],
    });

    await prompt.run();

    expect(prompt.installer.install).toHaveBeenCalledWith(['claude']);
    // No modal dialog is ever shown — that is the bug we removed.
    for (const call of prompt.notifications.showInformationMessage.mock.calls) {
      expect(call[1]).not.toMatchObject({ modal: true });
    }
  });

  it('opens a diff of the affected config when the user reviews changes', async () => {
    const prompt = createPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      infoChoices: ['Set Up Claude', 'Review changes'],
    });

    await prompt.run();

    expect(prompt.reviewer.showChanges).toHaveBeenCalledWith([
      { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
    ]);
  });

  it('installs without opening a diff when review is skipped', async () => {
    const prompt = createPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      infoChoices: ['Set Up Claude', undefined],
    });

    await prompt.run();

    expect(prompt.installer.install).toHaveBeenCalledWith(['claude']);
    expect(prompt.reviewer.showChanges).not.toHaveBeenCalled();
  });

  it('writes nothing when the setup notification is dismissed', async () => {
    const prompt = createPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      infoChoices: [undefined],
    });

    await prompt.run();

    expect(prompt.installer.install).not.toHaveBeenCalled();
  });

  it('offers a legacy Claude hook upgrade even after setup was dismissed', async () => {
    const prompt = createPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      deckHooks: new Set(['claude']),
      dismissed: true,
      infoChoices: ['Set Up Claude', undefined],
    });

    await prompt.run();

    expect(prompt.installer.install).toHaveBeenCalledWith(['claude']);
    expect(prompt.values[AGENT_HOOK_SETUP_DISMISSED_KEY]).toBe(true);
  });

  it('pre-ticks multiple offered agents and persists dismissal', async () => {
    const prompt = createPrompt({
      detected: [
        { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
        { agent: 'codex', configPath: '/home/me/.codex/hooks.json' },
      ],
      infoChoices: ['Set Up Claude and Codex'],
    });

    await prompt.run();

    expect(prompt.notifications.showQuickPick).toHaveBeenCalledWith(
      [
        { label: 'Claude', agent: 'claude', picked: true },
        { label: 'Codex', agent: 'codex', picked: true },
      ],
      expect.objectContaining({ canPickMany: true }),
    );
    expect(prompt.installer.install).toHaveBeenCalledWith(['claude', 'codex']);

    const dismissed = createPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      infoChoice: "Don't ask again",
    });
    await dismissed.run();
    expect(dismissed.values[AGENT_HOOK_SETUP_DISMISSED_KEY]).toBe(true);
  });

  it('skips the offer and selects agents straight away when invoked explicitly', async () => {
    const prompt = createPrompt({
      detected: [
        { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
        { agent: 'codex', configPath: '/home/me/.codex/hooks.json' },
      ],
      infoChoices: [undefined],
    });

    await prompt.run({ explicit: true });

    expect(prompt.notifications.showQuickPick).toHaveBeenCalled();
    expect(prompt.installer.install).toHaveBeenCalledWith(['claude', 'codex']);
    // No "Set Up / Don't ask again" offer — only the post-install review toast.
    expect(prompt.notifications.showInformationMessage).toHaveBeenCalledOnce();
  });

  it('reports instead of silently doing nothing when explicit and all installed', async () => {
    const prompt = createPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      currentInstalls: new Set(['claude']),
    });

    await prompt.run({ explicit: true });

    expect(prompt.installer.install).not.toHaveBeenCalled();
    expect(prompt.notifications.showInformationMessage).toHaveBeenCalledOnce();
  });

  it('reports instead of silently doing nothing when explicit and none detected', async () => {
    const prompt = createPrompt({ detected: [] });

    await prompt.run({ explicit: true });

    expect(prompt.installer.install).not.toHaveBeenCalled();
    expect(prompt.notifications.showInformationMessage).toHaveBeenCalledOnce();
  });

  it('clears a prior dismissal when install is invoked explicitly', async () => {
    const prompt = createPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      currentInstalls: new Set(['claude']),
      dismissed: true,
    });

    await prompt.run({ explicit: true });

    expect(prompt.values[AGENT_HOOK_SETUP_DISMISSED_KEY]).toBe(false);
  });

  it('uninstall reports when no agent hooks are installed', async () => {
    const prompt = createPrompt({ detected: [], currentInstalls: new Set() });

    await prompt.uninstall();

    expect(prompt.installer.remove).not.toHaveBeenCalled();
    expect(prompt.notifications.showInformationMessage).toHaveBeenCalledOnce();
  });

  it('uninstall removes legacy Claude hooks that are not current installs', async () => {
    const prompt = createPrompt({
      detected: [],
      currentInstalls: new Set(),
      deckHooks: new Set(['claude']),
    });

    await prompt.uninstall();

    expect(prompt.notifications.showQuickPick).not.toHaveBeenCalled();
    expect(prompt.installer.remove).toHaveBeenCalledWith(['claude']);
  });

  it('uninstall removes a single installed agent without prompting or dismissing', async () => {
    const prompt = createPrompt({ detected: [], currentInstalls: new Set(['claude']) });

    await prompt.uninstall();

    expect(prompt.notifications.showQuickPick).not.toHaveBeenCalled();
    expect(prompt.installer.remove).toHaveBeenCalledWith(['claude']);
    expect(prompt.values[AGENT_HOOK_SETUP_DISMISSED_KEY]).toBeUndefined();
  });

  it('uninstall quick-picks multiple installed agents and removes the selection', async () => {
    const prompt = createPrompt({ detected: [], currentInstalls: new Set(['claude', 'codex']) });

    await prompt.uninstall();

    expect(prompt.notifications.showQuickPick).toHaveBeenCalledWith(
      [
        { label: 'Claude', agent: 'claude', picked: true },
        { label: 'Codex', agent: 'codex', picked: true },
      ],
      expect.objectContaining({ canPickMany: true }),
    );
    expect(prompt.installer.remove).toHaveBeenCalledWith(['claude', 'codex']);
    // Uninstall never dismisses — only "Don't ask again" does.
    expect(prompt.values[AGENT_HOOK_SETUP_DISMISSED_KEY]).toBeUndefined();
  });

  it('uninstall removes only the selected agent and stays active when one remains', async () => {
    const prompt = createPrompt({
      detected: [],
      currentInstalls: new Set(['claude', 'codex']),
      pick: ['codex'],
    });

    await prompt.uninstall();

    expect(prompt.installer.remove).toHaveBeenCalledWith(['codex']);
    expect(prompt.values[AGENT_HOOK_SETUP_DISMISSED_KEY]).toBeUndefined();
  });
});

function createPrompt(input: {
  detected: Array<{ agent: AgentName; configPath: string }>;
  currentInstalls?: ReadonlySet<AgentName>;
  deckHooks?: ReadonlySet<AgentName>;
  infoChoice?: string;
  infoChoices?: Array<string | undefined>;
  dismissed?: boolean;
  pick?: AgentName[];
}) {
  const values: Record<string, unknown> = {};
  if (input.dismissed !== undefined) values[AGENT_HOOK_SETUP_DISMISSED_KEY] = input.dismissed;
  const infoChoices = [...(input.infoChoices ?? [input.infoChoice])];
  const notifications = {
    showInformationMessage: vi.fn(async () => infoChoices.shift()),
    // Selecting all pre-ticked items echoes them back; `pick` narrows the selection.
    showQuickPick: vi.fn(async (items: Array<{ agent: AgentName }>) =>
      input.pick ? items.filter((item) => input.pick!.includes(item.agent)) : items,
    ),
  };
  const installer = {
    isCurrentInstall: vi.fn(async (agent: AgentName) => input.currentInstalls?.has(agent) ?? false),
    hasDeckHooks: vi.fn(async (agent: AgentName) =>
      input.deckHooks?.has(agent) ?? input.currentInstalls?.has(agent) ?? false),
    install: vi.fn(async () => undefined),
    remove: vi.fn(async (agents: readonly AgentName[]) => [...agents]),
  };
  const reviewer = {
    showChanges: vi.fn(async () => undefined),
  };
  const prompt = new AgentSetupPrompt({
    detector: { detect: vi.fn(async () => input.detected) },
    installer,
    globalState: {
      get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
      update: vi.fn(async (key: string, value: unknown) => {
        values[key] = value;
      }),
    },
    notifications,
    reviewer,
  });
  return Object.assign(prompt, { notifications, installer, values, reviewer });
}
