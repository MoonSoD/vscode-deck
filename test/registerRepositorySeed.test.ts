import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    showErrorMessage: vi.fn(),
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
import { registerRepositorySeed } from '../src/repository/registerRepositorySeed';

function createDeps(repositories: string[] = ['/other/main']) {
  const registry = {
    list: vi.fn(() => repositories),
    append: vi.fn(async (repositoryPath: string) => {
      repositories.push(repositoryPath);
    }),
  };
  const activeWorktrees = { set: vi.fn(async () => undefined) };
  const refresh = vi.fn();
  const reveal = vi.fn(async () => undefined);

  return { activeWorktrees, refresh, registry, reveal };
}

describe('registerRepositorySeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers a valid seed at the bottom and reveals it', async () => {
    const { activeWorktrees, refresh, registry, reveal } = createDeps();

    const result = await registerRepositorySeed({
      seedPath: '/repo/main',
      registry,
      activeWorktrees,
      refresh,
      reveal,
    });

    expect(result).toEqual({ kind: 'registered', repositoryPath: '/repo/main', commonDir: '/git/repo' });
    expect(registry.append).toHaveBeenCalledWith('/repo/main');
    expect(registry.list()).toEqual(['/other/main', '/repo/main']);
    expect(activeWorktrees.set).toHaveBeenCalledWith('/git/repo', '/repo/main');
    expect(refresh).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith('/repo/main');
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });

  it('does nothing when a registered Repository has the same common dir', async () => {
    const { activeWorktrees, refresh, registry, reveal } = createDeps(['/repo/other']);

    const result = await registerRepositorySeed({
      seedPath: '/repo/main',
      registry,
      activeWorktrees,
      refresh,
      reveal,
    });

    expect(result).toEqual({ kind: 'duplicate', repositoryPath: '/repo/main', commonDir: '/git/repo' });
    expect(registry.append).not.toHaveBeenCalled();
    expect(activeWorktrees.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });

  it('rejects a non-git seed with a clear message', async () => {
    const { activeWorktrees, refresh, registry, reveal } = createDeps();

    const result = await registerRepositorySeed({
      seedPath: '/not-git',
      registry,
      activeWorktrees,
      refresh,
      reveal,
    });

    expect(result).toEqual({ kind: 'notGit', repositoryPath: '/not-git' });
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      'Cannot add /not-git: not a git repository.',
    );
    expect(registry.append).not.toHaveBeenCalled();
    expect(activeWorktrees.set).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });

  it('uses a sub-path as a discovery seed for the Repository common dir', async () => {
    const { activeWorktrees, refresh, registry, reveal } = createDeps();

    const result = await registerRepositorySeed({
      seedPath: '/repo/main/src',
      registry,
      activeWorktrees,
      refresh,
      reveal,
    });

    expect(result).toEqual({ kind: 'registered', repositoryPath: '/repo/main/src', commonDir: '/git/repo' });
    expect(registry.append).toHaveBeenCalledWith('/repo/main/src');
    expect(activeWorktrees.set).toHaveBeenCalledWith('/git/repo', '/repo/main/src');
    expect(refresh).toHaveBeenCalledOnce();
    expect(reveal).toHaveBeenCalledWith('/repo/main/src');
  });
});
