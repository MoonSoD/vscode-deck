import { describe, expect, it, vi } from 'vitest';
import { resolvePreviews } from '../src/browser/resolvePreviews';

describe('resolvePreviews', () => {
  it('merges committed, repository, and global sources in that order', async () => {
    const readRepo = vi.fn(async () => [{ name: 'app', portBase: 3000 }]);
    const resolveCommonDir = vi.fn(async (path: string) =>
      path === '/work/repo' || path === '/work/repo-main' ? '/work/repo/.git' : null,
    );

    await expect(resolvePreviews(
      '/work/repo',
      [{ name: 'admin', portBase: 4000 }],
      [{ repository: '/work/repo-main', previews: [{ name: 'storybook', portBase: 6006 }] }],
      { readRepo, resolveCommonDir },
    )).resolves.toEqual([
      { name: 'app', portBase: 3000 },
      { name: 'storybook', portBase: 6006 },
      { name: 'admin', portBase: 4000 },
    ]);
    expect(readRepo).toHaveBeenCalledWith('/work/repo');
  });

  it('dedupes by name, keeping the earliest source', async () => {
    const readRepo = vi.fn(async () => [{ name: 'app', portBase: 3000, portEnv: 'PORT' }]);
    const resolveCommonDir = vi.fn(async () => null);

    await expect(resolvePreviews(
      '/work/repo',
      [{ name: 'app', portBase: 9999 }],
      [],
      { readRepo, resolveCommonDir },
    )).resolves.toEqual([{ name: 'app', portBase: 3000, portEnv: 'PORT' }]);
  });

  it('returns an empty list when no source declares previews', async () => {
    await expect(resolvePreviews(
      '/work/repo',
      undefined,
      [],
      { readRepo: async () => [], resolveCommonDir: async () => null },
    )).resolves.toEqual([]);
  });
});
