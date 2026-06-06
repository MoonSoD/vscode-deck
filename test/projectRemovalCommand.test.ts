import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  showInformationMessage: vi.fn(),
  workspaceFolders: [{ uri: { fsPath: '/repo/feature' } }],
}));

vi.mock('vscode', () => ({
  ConfigurationTarget: {
    Global: 1,
  },
  window: {
    showInformationMessage: vscodeState.showInformationMessage,
  },
  workspace: {
    get workspaceFolders() {
      return vscodeState.workspaceFolders;
    },
  },
}));

vi.mock('../src/git/worktrees', () => ({
  getCommonDirSafe: vi.fn(async (worktreePath: string) => {
    if (worktreePath.startsWith('/repo')) return '/git/repo';
    if (worktreePath.startsWith('/other')) return '/git/other';
    return null;
  }),
  listWorktrees: vi.fn(async () => [
    {
      path: '/repo/main',
      head: 'abc',
      bare: false,
      detached: false,
      branch: 'main',
    },
    {
      path: '/repo/feature',
      head: 'def',
      bare: false,
      detached: false,
      branch: 'feature',
    },
  ]),
}));

import * as vscode from 'vscode';
import { listWorktrees } from '../src/git/worktrees';
import { ProjectRemovalCommand } from '../src/project/projectRemovalCommand';

describe('ProjectRemovalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/repo/feature' } }];
    vscodeState.showInformationMessage.mockResolvedValue('Remove from Deck');
    vi.mocked(listWorktrees).mockResolvedValue([
      {
        path: '/repo/main',
        head: 'abc',
        bare: false,
        detached: false,
        branch: 'main',
      },
      {
        path: '/repo/feature',
        head: 'def',
        bare: false,
        detached: false,
        branch: 'feature',
      },
    ]);
  });

  it('removes a Project from Deck and clears its per-Project state after confirmation', async () => {
    const activeWorktrees = { clear: vi.fn(async () => undefined) };
    const projectRegistry = { remove: vi.fn(async () => undefined) };
    const worktreeRoots = { clear: vi.fn(async () => undefined) };
    const worktreeOrders = { clear: vi.fn(async () => undefined) };
    const refresh = vi.fn();
    const command = new ProjectRemovalCommand(
      projectRegistry,
      activeWorktrees,
      worktreeRoots,
      worktreeOrders,
      refresh,
    );

    await command.run({ projectPath: '/repo/main' });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Remove `/repo/main` from Deck?',
      {
        modal: true,
        detail:
          "This only removes the Project from Deck. Files and git history are untouched.\n\nYou're currently in this Project's worktree. The folder will stay open, but Deck will no longer show this Project.",
      },
      'Remove from Deck',
    );
    expect(projectRegistry.remove).toHaveBeenCalledWith('/repo/main');
    expect(activeWorktrees.clear).toHaveBeenCalledWith('/git/repo');
    expect(worktreeRoots.clear).toHaveBeenCalledWith('/git/repo');
    expect(worktreeOrders.clear).toHaveBeenCalledWith('/git/repo');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('kills Deck terminal sessions for every known Worktree before removing the Project', async () => {
    const activeWorktrees = { clear: vi.fn(async () => undefined) };
    const projectRegistry = { remove: vi.fn(async () => undefined) };
    const worktreeRoots = { clear: vi.fn(async () => undefined) };
    const worktreeOrders = { clear: vi.fn(async () => undefined) };
    const terminalCascade = { killWorktree: vi.fn(async () => undefined) };
    const command = new ProjectRemovalCommand(
      projectRegistry,
      activeWorktrees,
      worktreeRoots,
      worktreeOrders,
      vi.fn(),
      terminalCascade,
    );

    await command.run({ projectPath: '/repo/main' });

    expect(listWorktrees).toHaveBeenCalledWith('/repo/main');
    expect(terminalCascade.killWorktree).toHaveBeenCalledWith('/repo/main');
    expect(terminalCascade.killWorktree).toHaveBeenCalledWith('/repo/feature');
    expect(terminalCascade.killWorktree.mock.invocationCallOrder.at(-1)).toBeLessThan(
      projectRegistry.remove.mock.invocationCallOrder[0],
    );
  });

  it('falls back to the worktree-list cache when git enumeration fails', async () => {
    const activeWorktrees = { clear: vi.fn(async () => undefined) };
    const projectRegistry = { remove: vi.fn(async () => undefined) };
    const worktreeRoots = { clear: vi.fn(async () => undefined) };
    const worktreeOrders = { clear: vi.fn(async () => undefined) };
    const terminalCascade = { killWorktree: vi.fn(async () => undefined) };
    const worktreeListCache = {
      get: vi.fn((commonDir: string) =>
        commonDir === '/git/repo'
          ? [{ path: '/repo/main' }, { path: '/repo/feature' }]
          : undefined,
      ),
    };
    vi.mocked(listWorktrees).mockRejectedValueOnce(new Error('corrupt git dir'));

    const command = new ProjectRemovalCommand(
      projectRegistry,
      activeWorktrees,
      worktreeRoots,
      worktreeOrders,
      vi.fn(),
      terminalCascade,
      worktreeListCache,
    );

    await command.run({ projectPath: '/repo/main' });

    expect(worktreeListCache.get).toHaveBeenCalledWith('/git/repo');
    expect(terminalCascade.killWorktree).toHaveBeenCalledWith('/repo/main');
    expect(terminalCascade.killWorktree).toHaveBeenCalledWith('/repo/feature');
    expect(projectRegistry.remove).toHaveBeenCalledWith('/repo/main');
  });

  it('continues removing the Project when terminal cascade fails', async () => {
    const activeWorktrees = { clear: vi.fn(async () => undefined) };
    const projectRegistry = { remove: vi.fn(async () => undefined) };
    const worktreeRoots = { clear: vi.fn(async () => undefined) };
    const worktreeOrders = { clear: vi.fn(async () => undefined) };
    const terminalCascade = {
      killWorktree: vi.fn(async () => {
        throw new Error('tmux socket busy');
      }),
    };
    const command = new ProjectRemovalCommand(
      projectRegistry,
      activeWorktrees,
      worktreeRoots,
      worktreeOrders,
      vi.fn(),
      terminalCascade,
    );

    await command.run({ projectPath: '/repo/main' });

    expect(projectRegistry.remove).toHaveBeenCalledWith('/repo/main');
  });

  it('does nothing when confirmation is cancelled', async () => {
    const activeWorktrees = { clear: vi.fn(async () => undefined) };
    const projectRegistry = { remove: vi.fn(async () => undefined) };
    const worktreeRoots = { clear: vi.fn(async () => undefined) };
    const worktreeOrders = { clear: vi.fn(async () => undefined) };
    const refresh = vi.fn();
    const command = new ProjectRemovalCommand(
      projectRegistry,
      activeWorktrees,
      worktreeRoots,
      worktreeOrders,
      refresh,
    );

    vscodeState.showInformationMessage.mockResolvedValue(undefined);

    await command.run({ projectPath: '/repo/main' });

    expect(projectRegistry.remove).not.toHaveBeenCalled();
    expect(activeWorktrees.clear).not.toHaveBeenCalled();
    expect(worktreeRoots.clear).not.toHaveBeenCalled();
    expect(worktreeOrders.clear).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
