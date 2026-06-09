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
      infoChoices: ['Set Up Codex', 'Install Hooks'],
    });

    await prompt.run();

    expect(prompt.notifications.showQuickPick).not.toHaveBeenCalled();
    expect(prompt.installer.install).toHaveBeenCalledWith(['codex']);
  });

  it('renders the installer preview and restart expectation before writing', async () => {
    const previewContents = '{\n  "hooks": {}\n}\n';
    const prompt = createPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      infoChoices: ['Set Up Claude', 'Install Hooks'],
      preview: [{
        agent: 'claude',
        configPath: '/home/me/.claude/settings.json',
        contents: previewContents,
      }],
    });

    await prompt.run();

    expect(prompt.installer.preview).toHaveBeenCalledWith(['claude']);
    expect(prompt.notifications.showInformationMessage).toHaveBeenLastCalledWith(
      'Review Deck agent hook setup',
      {
        modal: true,
        detail: [
          'Deck will write this agent hook config change:',
          '',
          'Claude: /home/me/.claude/settings.json',
          previewContents,
          'Agents already running must be restarted before Deck can track them.',
        ].join('\n'),
      },
      'Install Hooks',
      'Cancel',
    );
    expect(prompt.installer.install).toHaveBeenCalledWith(['claude']);
  });

  it('arms verification after installing hooks', async () => {
    const prompt = createPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      infoChoices: ['Set Up Claude', 'Install Hooks'],
    });

    await prompt.run();

    expect(prompt.verifier.arm).toHaveBeenCalledOnce();
  });

  it('writes nothing when the setup preview is cancelled', async () => {
    const prompt = createPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      infoChoices: ['Set Up Claude', undefined],
    });

    await prompt.run();

    expect(prompt.installer.preview).toHaveBeenCalledWith(['claude']);
    expect(prompt.installer.install).not.toHaveBeenCalled();
  });

  it('pre-ticks multiple offered agents and persists dismissal', async () => {
    const prompt = createPrompt({
      detected: [
        { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
        { agent: 'codex', configPath: '/home/me/.codex/hooks.json' },
      ],
      infoChoices: ['Set Up Claude and Codex', 'Install Hooks'],
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
  infoChoices?: Array<string | undefined>;
  preview?: Array<{ agent: AgentName; configPath: string; contents: string }>;
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
    preview: vi.fn(async () => input.preview ?? []),
    install: vi.fn(async () => undefined),
  };
  const verifier = {
    arm: vi.fn(),
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
    verifier,
  });
  return Object.assign(prompt, { notifications, installer, values, verifier });
}
