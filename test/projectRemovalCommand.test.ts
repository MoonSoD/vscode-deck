import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  projects: ['/repo/main', '/other/main'],
  showInformationMessage: vi.fn(),
  update: vi.fn(),
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
    getConfiguration: () => ({
      get: <T>(_key: string, defaultValue: T) =>
        (vscodeState.projects as T | undefined) ?? defaultValue,
      update: vscodeState.update,
    }),
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
    vscodeState.projects = ['/repo/main', '/other/main'];
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/repo/feature' } }];
    vscodeState.showInformationMessage.mockResolvedValue('Remove from Deck');
    vscodeState.update.mockResolvedValue(undefined);
  });

  it('removes a Project from Deck and clears its per-Project state after confirmation', async () => {
    const activeWorktrees = { clear: vi.fn(async () => undefined) };
    const worktreeRoots = { clear: vi.fn(async () => undefined) };
    const refresh = vi.fn();
    const command = new ProjectRemovalCommand(activeWorktrees, worktreeRoots, refresh);

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
    expect(vscodeState.update).toHaveBeenCalledWith(
      'projects',
      ['/other/main'],
      vscode.ConfigurationTarget.Global,
    );
    expect(activeWorktrees.clear).toHaveBeenCalledWith('/git/repo');
    expect(worktreeRoots.clear).toHaveBeenCalledWith('/git/repo');
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('does nothing when confirmation is cancelled', async () => {
    const activeWorktrees = { clear: vi.fn(async () => undefined) };
    const worktreeRoots = { clear: vi.fn(async () => undefined) };
    const refresh = vi.fn();
    const command = new ProjectRemovalCommand(activeWorktrees, worktreeRoots, refresh);

    vscodeState.showInformationMessage.mockResolvedValue(undefined);

    await command.run({ projectPath: '/repo/main' });

    expect(vscodeState.update).not.toHaveBeenCalled();
    expect(activeWorktrees.clear).not.toHaveBeenCalled();
    expect(worktreeRoots.clear).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });
});
