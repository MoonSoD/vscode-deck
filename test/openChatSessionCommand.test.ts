import { describe, expect, it, vi } from 'vitest';
import { openChatSession, type OpenChatSessionDeps } from '../src/chat/openChatSessionCommand';

function deps(overrides: Partial<OpenChatSessionDeps> = {}): OpenChatSessionDeps {
  return {
    isExtensionInstalled: () => true,
    showExtensionMissing: vi.fn(),
    currentWorkspacePath: () => '/work/alpha',
    reveal: vi.fn(async () => undefined),
    openInWorktreeWindow: vi.fn(async () => undefined),
    ...overrides,
  };
}

const target = { sessionId: 'sess-1', worktreePath: '/work/alpha', worktreeLabel: 'main' };

describe('openChatSession', () => {
  it('reveals a session that belongs to the current worktree', async () => {
    const reveal = vi.fn(async () => undefined);
    await openChatSession(target, deps({ reveal }));
    expect(reveal).toHaveBeenCalledWith('sess-1');
  });

  it('opens the owning worktree window for a session from another worktree', async () => {
    const reveal = vi.fn(async () => undefined);
    const openInWorktreeWindow = vi.fn(async () => undefined);
    const other = { sessionId: 'sess-1', worktreePath: '/work/beta', worktreeLabel: 'feature' };
    await openChatSession(other, deps({ currentWorkspacePath: () => '/work/alpha', reveal, openInWorktreeWindow }));
    expect(openInWorktreeWindow).toHaveBeenCalledWith(other);
    expect(reveal).not.toHaveBeenCalled();
  });

  it('prompts to install the extension and does nothing else when it is absent', async () => {
    const reveal = vi.fn(async () => undefined);
    const showExtensionMissing = vi.fn();
    await openChatSession(target, deps({ isExtensionInstalled: () => false, reveal, showExtensionMissing }));
    expect(showExtensionMissing).toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });
});
