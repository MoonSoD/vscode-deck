import { describe, expect, it } from 'vitest';
import { NotificationGate } from '../src/agent/notificationGate';

describe('NotificationGate', () => {
  it('offers detected agents whose hooks are absent', () => {
    expect(NotificationGate.shouldPrompt({
      detected: [
        { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
        { agent: 'codex', configPath: '/home/me/.codex/hooks.json' },
      ],
      installed: new Set(['claude']),
      dismissed: false,
    })).toEqual(['codex']);
  });

  it('stays quiet when no agent is detected, hooks are installed, or dismissed', () => {
    expect(NotificationGate.shouldPrompt({
      detected: [],
      installed: new Set(),
      dismissed: false,
    })).toEqual([]);
    expect(NotificationGate.shouldPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      installed: new Set(['claude']),
      dismissed: false,
    })).toEqual([]);
    expect(NotificationGate.shouldPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      installed: new Set(),
      dismissed: true,
    })).toEqual([]);
  });
});
