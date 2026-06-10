import { describe, expect, it } from 'vitest';
import { NotificationGate } from '../src/agent/notificationGate';

describe('NotificationGate', () => {
  it('offers detected agents whose hooks are absent', () => {
    expect(NotificationGate.shouldPrompt({
      detected: [
        { agent: 'claude', configPath: '/home/me/.claude/settings.json' },
        { agent: 'codex', configPath: '/home/me/.codex/hooks.json' },
      ],
      currentInstalls: new Set(['claude']),
      deckHookInstalls: new Set(['claude']),
      dismissed: false,
    })).toEqual(['codex']);
  });

  it('stays quiet for detected agents that already have Deck hooks', () => {
    expect(NotificationGate.shouldPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      currentInstalls: new Set(),
      deckHookInstalls: new Set(['claude']),
      dismissed: true,
    })).toEqual([]);
  });

  it('stays quiet when no agent is detected, hooks are current, or fresh setup is dismissed', () => {
    expect(NotificationGate.shouldPrompt({
      detected: [],
      currentInstalls: new Set(),
      deckHookInstalls: new Set(),
      dismissed: false,
    })).toEqual([]);
    expect(NotificationGate.shouldPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      currentInstalls: new Set(['claude']),
      deckHookInstalls: new Set(['claude']),
      dismissed: false,
    })).toEqual([]);
    expect(NotificationGate.shouldPrompt({
      detected: [{ agent: 'claude', configPath: '/home/me/.claude/settings.json' }],
      currentInstalls: new Set(),
      deckHookInstalls: new Set(),
      dismissed: true,
    })).toEqual([]);
  });
});
