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
      installed: new Set(['claude']),
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
      installed: new Set(['claude']),
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
});

function createPrompt(input: {
  detected: Array<{ agent: AgentName; configPath: string }>;
  installed?: ReadonlySet<AgentName>;
  infoChoice?: string;
  infoChoices?: Array<string | undefined>;
}) {
  const values: Record<string, unknown> = {};
  const infoChoices = [...(input.infoChoices ?? [input.infoChoice])];
  const quickPickChoice = input.detected.map((agent) => ({
    label: agent.agent === 'claude' ? 'Claude' : 'Codex',
    agent: agent.agent,
    picked: true,
  }));
  const notifications = {
    showInformationMessage: vi.fn(async () => infoChoices.shift()),
    showQuickPick: vi.fn(async () => quickPickChoice),
  };
  const installer = {
    isInstalled: vi.fn(async (agent: AgentName) => input.installed?.has(agent) ?? false),
    install: vi.fn(async () => undefined),
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
