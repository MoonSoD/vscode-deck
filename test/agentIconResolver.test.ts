import { describe, expect, it } from 'vitest';
import { resolveAgentIcon } from '../src/agent/agentIconResolver';

const resourcesDir = '/extension/resources';

describe('resolveAgentIcon', () => {
  it('resolves a codex window with no status to the Codex identity icon', () => {
    expect(resolveAgentIcon({ windowName: 'codex', resourcesDir })).toEqual({
      iconPath: { fsPath: '/extension/resources/codex-code.png' },
      isAgent: true,
      agent: 'codex',
      state: 'identity',
    });
  });

  it('resolves a codex InProgress status to the Codex working icon', () => {
    expect(resolveAgentIcon({
      windowName: 'codex',
      resourcesDir,
      status: { status: 'inProgress', statusAt: 1710000000 },
    }).iconPath).toEqual({
      fsPath: '/extension/resources/codex-working.gif',
    });
  });

  it('preserves Claude identity and working icons', () => {
    expect(resolveAgentIcon({ windowName: 'claude', resourcesDir }).iconPath).toEqual({
      fsPath: '/extension/resources/claude-code.png',
    });
    expect(resolveAgentIcon({
      windowName: 'claude',
      resourcesDir,
      status: { status: 'inProgress', statusAt: 1710000000 },
    }).iconPath).toEqual({
      fsPath: '/extension/resources/claude-working.gif',
    });
  });

  it('treats a status-only terminal without an agent as Claude (legacy fallback)', () => {
    expect(resolveAgentIcon({
      windowName: 'zsh',
      resourcesDir,
      status: { status: 'inProgress', statusAt: 1710000000 },
    }).iconPath).toEqual({
      fsPath: '/extension/resources/claude-working.gif',
    });
  });

  it('uses status.agent for a status-only terminal, not the Claude default', () => {
    expect(resolveAgentIcon({
      windowName: 'zsh',
      resourcesDir,
      status: { status: 'inProgress', statusAt: 1710000000, agent: 'codex' },
    })).toEqual({
      iconPath: { fsPath: '/extension/resources/codex-working.gif' },
      isAgent: true,
      agent: 'codex',
      state: 'working',
    });
  });

  it('resolves a non-agent terminal with no status to the terminal theme icon', () => {
    expect(resolveAgentIcon({ windowName: 'zsh', resourcesDir })).toEqual({
      iconPath: { id: 'terminal' },
      isAgent: false,
    });
  });

  it('never resolves a Codex terminal to a Claude asset', () => {
    const icons = [
      resolveAgentIcon({ windowName: 'codex', resourcesDir }).iconPath,
      resolveAgentIcon({
        windowName: 'codex',
        resourcesDir,
        status: { status: 'inProgress', statusAt: 1710000000 },
      }).iconPath,
    ];

    expect(icons).not.toContainEqual({ fsPath: '/extension/resources/claude-code.png' });
    expect(icons).not.toContainEqual({ fsPath: '/extension/resources/claude-working.gif' });
  });
});
