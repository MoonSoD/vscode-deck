import { describe, expect, it } from 'vitest';
import { addProjectMount } from '../src/projects/addProjectMount';
import { WorkspaceRoot } from '../src/switch/workspaceRootPlanner';

describe('addProjectMount', () => {
  it('registers a new project, records its active worktree, and appends it', async () => {
    let projects = ['/work/alpha'];
    const activeWorktrees: Record<string, string> = {};
    const appendedRoots: WorkspaceRoot[] = [];
    const writes: string[] = [];

    await addProjectMount('/work/beta', {
      listProjects: () => projects,
      updateProjects: async (next) => {
        projects = [...next];
      },
      getCommonDir: async (worktreePath) => `/git/${worktreePath.split('/').pop()}`,
      getCurrentRoots: async () => [{ path: '/work/alpha', commonDir: '/git/alpha' }],
      appendWorkspaceRoots: async (roots) => {
        writes.push('append');
        appendedRoots.push(...roots);
      },
      setActiveWorktree: async (commonDir, worktreePath) => {
        writes.push('active');
        activeWorktrees[commonDir] = worktreePath;
      },
    });

    expect(projects).toEqual(['/work/alpha', '/work/beta']);
    expect(activeWorktrees).toEqual({ '/git/beta': '/work/beta' });
    expect(appendedRoots).toEqual([{ path: '/work/beta', commonDir: '/git/beta' }]);
    expect(writes).toEqual(['active', 'append']);
  });

  it('does not duplicate an already registered project with the same common dir', async () => {
    let projects = ['/work/beta-main'];
    const activeWorktrees: Record<string, string> = {};
    const appendedRoots: WorkspaceRoot[] = [];

    await addProjectMount('/work/beta-feature', {
      listProjects: () => projects,
      updateProjects: async (next) => {
        projects = [...next];
      },
      getCommonDir: async () => '/git/beta',
      getCurrentRoots: async () => [],
      appendWorkspaceRoots: async (roots) => {
        appendedRoots.push(...roots);
      },
      setActiveWorktree: async (commonDir, worktreePath) => {
        activeWorktrees[commonDir] = worktreePath;
      },
    });

    expect(projects).toEqual(['/work/beta-main']);
    expect(activeWorktrees).toEqual({});
    expect(appendedRoots).toEqual([]);
  });
});
