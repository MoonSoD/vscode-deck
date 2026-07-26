import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  ViewColumn: { Active: -1 },
  Uri: {
    from(value: { scheme: string; authority: string; path: string; query: string }) {
      return value;
    },
  },
  commands: { executeCommand: vi.fn(async () => undefined) },
  window: { showQuickPick: vi.fn(), showInformationMessage: vi.fn() },
}));

import { RunPreviewCommand } from '../src/browser/runPreviewCommand';

const node = { worktree: { path: '/work/repo' } };

function fakeTmux() {
  return {
    listSessions: vi.fn(async () => []),
    ensureSession: vi.fn(async () => undefined),
    sendCommandLine: vi.fn(async () => undefined),
  };
}

describe('RunPreviewCommand', () => {
  it('runs the sole runnable preview in a new terminal with the port env injected', async () => {
    const tmux = fakeTmux();
    const refresh = vi.fn();
    await new RunPreviewCommand(tmux, {
      resolvePreviews: async () => [{ name: 'app', portBase: 3000, command: 'pnpm dev' }],
      resolvePreviewEnv: async () => ({ PORT: '3042' }),
      refresh,
    }).run(node);

    expect(tmux.ensureSession).toHaveBeenCalledWith('wt-_work_repo__term-1', '/work/repo', { PORT: '3042' });
    expect(tmux.sendCommandLine).toHaveBeenCalledWith('wt-_work_repo__term-1', 'pnpm dev');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('prompts a Quick Pick when several previews are runnable', async () => {
    const tmux = fakeTmux();
    const pickPreview = vi.fn(async (previews) => previews[1]);
    await new RunPreviewCommand(tmux, {
      resolvePreviews: async () => [
        { name: 'app', portBase: 3000, command: 'pnpm dev' },
        { name: 'storybook', portBase: 6006, command: 'pnpm storybook' },
      ],
      pickPreview,
    }).run(node);

    expect(pickPreview).toHaveBeenCalledOnce();
    expect(tmux.sendCommandLine).toHaveBeenCalledWith('wt-_work_repo__term-1', 'pnpm storybook');
  });

  it('ignores previews without a command and notifies when none are runnable', async () => {
    const tmux = fakeTmux();
    const notifyNoRunnablePreviews = vi.fn();
    await new RunPreviewCommand(tmux, {
      resolvePreviews: async () => [{ name: 'app', portBase: 3000 }],
      notifyNoRunnablePreviews,
    }).run(node);

    expect(tmux.ensureSession).not.toHaveBeenCalled();
    expect(notifyNoRunnablePreviews).toHaveBeenCalledOnce();
  });
});
