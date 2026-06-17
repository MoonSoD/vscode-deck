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

  it('resolves a codex InProgress status to the loading spinner codicon', () => {
    expect(resolveAgentIcon({
      windowName: 'codex',
      resourcesDir,
      status: { status: 'inProgress', statusAt: 1710000000 },
    })).toEqual({
      iconPath: { id: 'loading~spin' },
      isAgent: true,
      agent: 'codex',
      state: 'working',
    });
  });

  it('preserves Claude identity and uses the shared working spinner', () => {
    expect(resolveAgentIcon({ windowName: 'claude', resourcesDir }).iconPath).toEqual({
      fsPath: '/extension/resources/claude-code.png',
    });
    expect(resolveAgentIcon({
      windowName: 'claude',
      resourcesDir,
      status: { status: 'inProgress', statusAt: 1710000000 },
    })).toEqual({
      iconPath: { id: 'loading~spin' },
      isAgent: true,
      agent: 'claude',
      state: 'working',
    });
  });

  it('treats a status-only terminal without an agent as Claude (legacy fallback)', () => {
    expect(resolveAgentIcon({
      windowName: 'zsh',
      resourcesDir,
      status: { status: 'inProgress', statusAt: 1710000000 },
    })).toEqual({
      iconPath: { id: 'loading~spin' },
      isAgent: true,
      agent: 'claude',
      state: 'working',
    });
  });

  it('uses status.agent for a status-only terminal, not the Claude default', () => {
    expect(resolveAgentIcon({
      windowName: 'zsh',
      resourcesDir,
      status: { status: 'inProgress', statusAt: 1710000000, agent: 'codex' },
    })).toEqual({
      iconPath: { id: 'loading~spin' },
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
    ];

    expect(icons).not.toContainEqual({ fsPath: '/extension/resources/claude-code.png' });
  });
});
