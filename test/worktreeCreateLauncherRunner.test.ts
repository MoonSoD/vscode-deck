import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  executeCommand: vi.fn(async () => undefined),
  userLaunchers: [] as unknown[],
}));

vi.mock('vscode', () => ({
  commands: {
    executeCommand: vscodeState.executeCommand,
  },
  workspace: {
    getConfiguration: () => ({
      get: (_key: string, defaultValue: unknown) => vscodeState.userLaunchers ?? defaultValue,
    }),
  },
}));

import { WorktreeCreateLauncherRunner } from '../src/terminal/worktreeCreateLauncherRunner';

describe('WorktreeCreateLauncherRunner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.userLaunchers = [];
  });

  it('runs flagged launchers repo-first in distinct headless terminals', async () => {
    const sessions: Array<{ sessionName: string; windowName: string }> = [];
    const tmux = {
      listSessions: vi.fn(async (prefix?: string) =>
        sessions.filter((session) => !prefix || session.sessionName.startsWith(prefix)),
      ),
      ensureSession: vi.fn(async (sessionName: string) => {
        sessions.push({ sessionName, windowName: 'zsh' });
      }),
      sendCommandLine: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const resolveLaunchers = vi.fn(async () => ({
      repo: [
        { label: 'Dev', command: 'npm run dev' },
        { label: 'Bootstrap', command: 'pnpm bootstrap', runOnWorktreeCreate: true },
      ],
      user: [
        { label: 'Claude', command: 'claude', runOnWorktreeCreate: true },
      ],
    }));
    vscodeState.userLaunchers = [{ label: 'Claude', command: 'claude', runOnWorktreeCreate: true }];

    await new WorktreeCreateLauncherRunner(tmux, { refresh, resolveLaunchers }).run({
      worktree: { path: '/work/repo' },
    });

    expect(resolveLaunchers).toHaveBeenCalledWith('/work/repo', vscodeState.userLaunchers);
    expect(tmux.ensureSession).toHaveBeenNthCalledWith(1, 'wt-_work_repo__term-1', '/work/repo');
    expect(tmux.ensureSession).toHaveBeenNthCalledWith(2, 'wt-_work_repo__term-2', '/work/repo');
    expect(tmux.sendCommandLine).toHaveBeenNthCalledWith(
      1,
      'wt-_work_repo__term-1',
      'pnpm bootstrap',
    );
    expect(tmux.sendCommandLine).toHaveBeenNthCalledWith(2, 'wt-_work_repo__term-2', 'claude');
    expect(vscodeState.executeCommand).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does not create terminals when no launchers are flagged', async () => {
    const tmux = {
      listSessions: vi.fn(async () => []),
      ensureSession: vi.fn(async () => undefined),
      sendCommandLine: vi.fn(async () => undefined),
    };
    const refresh = vi.fn();
    const beforeCreate = vi.fn(async () => undefined);
    const resolveLaunchers = vi.fn(async () => ({
      repo: [{ label: 'Dev', command: 'npm run dev' }],
      user: [{ label: 'Watch', command: 'npm test -- --watch' }],
    }));

    await new WorktreeCreateLauncherRunner(tmux, {
      beforeCreate,
      refresh,
      resolveLaunchers,
    }).run({ worktree: { path: '/work/repo' } });

    expect(beforeCreate).not.toHaveBeenCalled();
    expect(tmux.ensureSession).not.toHaveBeenCalled();
    expect(tmux.sendCommandLine).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
