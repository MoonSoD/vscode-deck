import { describe, expect, it } from 'vitest';
import { resolveAgentIcon, resolveTerminalTabIcon } from '../src/agent/agentIconResolver';

const resourcesDir = '/extension/resources';

describe('resolveAgentIcon', () => {
  it('resolves a codex window with no status to the Codex identity icon', () => {
    expect(resolveAgentIcon({ windowName: 'codex', resourcesDir })).toEqual({
      iconPath: { fsPath: '/extension/resources/codex-code-padded.png' },
      isAgent: true,
      agent: 'codex',
      state: 'identity',
      surface: 'tree',
    });
  });

  it('resolves a codex InProgress status to the Codex working icon', () => {
    expect(resolveAgentIcon({
      windowName: 'codex',
      resourcesDir,
      status: { status: 'inProgress', statusAt: 1710000000 },
    }).iconPath).toEqual({
      fsPath: '/extension/resources/codex-working-padded.gif',
    });
  });

  it('preserves Claude identity and working icons', () => {
    expect(resolveAgentIcon({ windowName: 'claude', resourcesDir }).iconPath).toEqual({
      fsPath: '/extension/resources/claude-code-padded.png',
    });
    expect(resolveAgentIcon({
      windowName: 'claude',
      resourcesDir,
      status: { status: 'inProgress', statusAt: 1710000000 },
    }).iconPath).toEqual({
      fsPath: '/extension/resources/claude-working-padded.gif',
    });
  });

  it('treats a status-only terminal without an agent as Claude (legacy fallback)', () => {
    expect(resolveAgentIcon({
      windowName: 'zsh',
      resourcesDir,
      status: { status: 'inProgress', statusAt: 1710000000 },
    }).iconPath).toEqual({
      fsPath: '/extension/resources/claude-working-padded.gif',
    });
  });

  it('uses status.agent for a status-only terminal, not the Claude default', () => {
    expect(resolveAgentIcon({
      windowName: 'zsh',
      resourcesDir,
      status: { status: 'inProgress', statusAt: 1710000000, agent: 'codex' },
    })).toEqual({
      iconPath: { fsPath: '/extension/resources/codex-working-padded.gif' },
      isAgent: true,
      agent: 'codex',
      state: 'working',
      surface: 'tree',
    });
  });

  it('resolves a non-agent terminal tab to the built-in terminal theme icon', () => {
    expect(resolveTerminalTabIcon({ windowName: 'zsh', resourcesDir })).toEqual({
      iconPath: { id: 'terminal' },
      isAgent: false,
    });
  });

  it('resolves agent terminal tabs to centered generated rasters', () => {
    expect(resolveTerminalTabIcon({ windowName: 'claude', resourcesDir })).toEqual({
      iconPath: { fsPath: '/extension/resources/claude-code-padded-center.png' },
      isAgent: true,
      agent: 'claude',
      state: 'identity',
      surface: 'tab',
    });
    expect(resolveTerminalTabIcon({
      windowName: 'zsh',
      resourcesDir,
      status: { status: 'inProgress', statusAt: 1710000000, agent: 'codex' },
    })).toEqual({
      iconPath: { fsPath: '/extension/resources/codex-working-padded-center.gif' },
      isAgent: true,
      agent: 'codex',
      state: 'working',
      surface: 'tab',
    });
  });

  it('resolves an agent tab from explicit agentName when the window name is a volatile process name', () => {
    expect(resolveTerminalTabIcon({ windowName: '2.1.172', resourcesDir, agentName: 'claude' })).toEqual({
      iconPath: { fsPath: '/extension/resources/claude-code-padded-center.png' },
      isAgent: true,
      agent: 'claude',
      state: 'identity',
      surface: 'tab',
    });
  });

  it('resolves a non-agent sidebar terminal to the padded terminal theme icon', () => {
    expect(resolveAgentIcon({ windowName: 'zsh', resourcesDir })).toEqual({
      iconPath: { id: 'deck-terminal' },
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

    expect(icons).not.toContainEqual({ fsPath: '/extension/resources/claude-code-padded.png' });
    expect(icons).not.toContainEqual({ fsPath: '/extension/resources/claude-working-padded.gif' });
  });
});
