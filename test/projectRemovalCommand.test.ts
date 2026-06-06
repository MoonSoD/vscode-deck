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
}));

import * as vscode from 'vscode';
import { ProjectRemovalCommand } from '../src/project/projectRemovalCommand';

describe('ProjectRemovalCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/repo/feature' } }];
    vscodeState.showInformationMessage.mockResolvedValue('Remove from Deck');
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
