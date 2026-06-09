import { describe, expect, it, vi } from 'vitest';
import { AGENT_HOOK_SETUP_DISMISSED_KEY, AgentSetupPrompt } from '../src/agent/agentSetupPrompt';
import type { AgentName } from '../src/agent/agentTypes';

describe('AgentSetupPrompt', () => {
  it('shows no notification when no agent is detected', async () => {
    const prompt = createPrompt({ detected: [] });

    await prompt.run();

    expect(prompt.notifications.showInformationMessage).not.toHaveBeenCalled();
  });

  it('offers only detected uninstalled agents pre-ticked and installs selected agents', async () => {
    const prompt = createPrompt({
      detected: [
        { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
        { agent: 'codex', configPath: '/home/me/.codex/hooks.json' },
      ],
      installed: new Set(['claude']),
      infoChoice: 'Set Up Codex',
    });

    await prompt.run();

    expect(prompt.notifications.showQuickPick).not.toHaveBeenCalled();
    expect(prompt.installer.install).toHaveBeenCalledWith(['codex']);
  });

  it('pre-ticks multiple offered agents and persists dismissal', async () => {
    const prompt = createPrompt({
      detected: [
        { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
        { agent: 'codex', configPath: '/home/me/.codex/hooks.json' },
      ],
      infoChoice: 'Set Up Claude and Codex',
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
});

function createPrompt(input: {
  detected: Array<{ agent: AgentName; configPath: string }>;
  installed?: ReadonlySet<AgentName>;
  infoChoice?: string;
}) {
  const values: Record<string, unknown> = {};
  const quickPickChoice = input.detected.map((agent) => ({
    label: agent.agent === 'claude' ? 'Claude' : 'Codex',
    agent: agent.agent,
    picked: true,
  }));
  const notifications = {
    showInformationMessage: vi.fn(async () => input.infoChoice),
    showQuickPick: vi.fn(async () => quickPickChoice),
  };
  const installer = {
    isInstalled: vi.fn(async (agent: AgentName) => input.installed?.has(agent) ?? false),
    install: vi.fn(async () => undefined),
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
  });
  return Object.assign(prompt, { notifications, installer, values });
}
