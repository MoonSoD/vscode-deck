import { describe, expect, it } from 'vitest';
import { describeChatSessionTreeItem } from '../src/tree/worktreeTreeItem';
import type { ChatSession } from '../src/chat/scanChatSessions';

const HOUR = 60 * 60 * 1000;
const NOW = 1_000_000 * HOUR;

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return { sessionId: 's1', cwd: '/work/frontend', lastModified: NOW, ...overrides };
}

describe('describeChatSessionTreeItem', () => {
  it('labels the row with the session title', () => {
    const item = describeChatSessionTreeItem(session({ title: 'Debug failing tests' }), NOW);
    expect(item.label).toBe('Debug failing tests');
  });

  it('falls back to the branch, then a generic label, when there is no title', () => {
    expect(describeChatSessionTreeItem(session({ gitBranch: 'main' }), NOW).label).toBe('main');
    expect(describeChatSessionTreeItem(session(), NOW).label).toBe('Claude Code');
  });

  it('describes the row with a relative age', () => {
    const item = describeChatSessionTreeItem(session({ lastModified: NOW - 2 * HOUR }), NOW);
    expect(item.description).toBe('2h');
  });

  it('marks an open session with a green dot in the description', () => {
    const item = describeChatSessionTreeItem(session({ title: 'X', lastModified: NOW }), NOW, { open: true });
    expect(item.description).toContain('🟢');
  });

  it('carries a chat-session context value for menus', () => {
    expect(describeChatSessionTreeItem(session(), NOW).contextValue).toBe('deck.chatSession');
  });

  it('resolves the Claude tree icon when icon options are supplied', () => {
    const item = describeChatSessionTreeItem(session(), NOW, {
      icon: {
        resourcesDir: '/res',
        factory: { uriFile: (path: string) => ({ fsPath: path }), themeIcon: (id: string) => ({ id }) },
      },
    });
    expect(item.iconPath).toEqual({ fsPath: '/res/claude-code-padded.png' });
  });
});
