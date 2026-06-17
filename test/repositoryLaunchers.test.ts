import { describe, expect, it } from 'vitest';
import {
  parseRepositoryLaunchers,
  selectRepositoryLaunchersFor,
} from '../src/launchers/repositoryLaunchers';

describe('parseRepositoryLaunchers', () => {
  it('returns an empty list for non-array settings', () => {
    expect(parseRepositoryLaunchers({ repository: '/work/repo' })).toEqual([]);
  });

  it('keeps valid repository entries and parses their launchers', () => {
    expect(parseRepositoryLaunchers([
      {
        repository: ' /work/repo ',
        launchers: [
          { label: 'Bootstrap', command: 'pnpm bootstrap', runOnWorktreeCreate: true },
          { command: 'npm test' },
          { label: 'No command' },
        ],
      },
      { repository: '', launchers: [{ command: 'ignored' }] },
      { repository: '/work/empty', launchers: 'ignored' },
      null,
    ])).toEqual([
      {
        repository: '/work/repo',
        launchers: [
          { label: 'Bootstrap', command: 'pnpm bootstrap', runOnWorktreeCreate: true },
          { label: 'npm test', command: 'npm test' },
        ],
      },
      {
        repository: '/work/empty',
        launchers: [],
      },
    ]);
  });
});

describe('selectRepositoryLaunchersFor', () => {
  it('matches repository entries by common dir instead of raw path', async () => {
    const launchers = [{ label: 'Bootstrap', command: 'pnpm bootstrap' }];
    const commonDirs = new Map([
      ['/work/repo-feature', '/work/repo/.git'],
      ['/work/repo-main', '/work/repo/.git'],
    ]);

    await expect(selectRepositoryLaunchersFor(
      '/work/repo-feature',
      [{ repository: '/work/repo-main', launchers }],
      async (path) => commonDirs.get(path) ?? null,
    )).resolves.toEqual(launchers);
  });

  it('ignores unmatched or unresolvable repository entries', async () => {
    await expect(selectRepositoryLaunchersFor(
      '/work/repo',
      [
        {
          repository: '/work/other',
          launchers: [{ label: 'Other', command: 'npm run other' }],
        },
        {
          repository: '/missing/repo',
          launchers: [{ label: 'Missing', command: 'npm run missing' }],
        },
      ],
      async (path) => {
        if (path === '/work/repo') return '/work/repo/.git';
        if (path === '/work/other') return '/work/other/.git';
        return null;
      },
    )).resolves.toEqual([]);
  });
});
