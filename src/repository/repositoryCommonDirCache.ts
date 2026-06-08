import { getCommonDir, getCommonDirSafe } from '../git/worktrees';
import type { MementoLike } from '../switch/activeWorktreeStore';

export const REPOSITORY_COMMON_DIR_CACHE_KEY = 'deck.repositoryCommonDirCache';
export const REPOSITORY_COMMON_DIR_CACHE_SCHEMA_VERSION = 1;

interface RepositoryCommonDirCacheEntry {
  schemaVersion: number;
  commonDir: string;
}

export class RepositoryCommonDirCache {
  constructor(private readonly memento: MementoLike) {}

  get(repositoryPath: string): string | undefined {
    const entry = this.all()[repositoryPath];
    if (entry?.schemaVersion !== REPOSITORY_COMMON_DIR_CACHE_SCHEMA_VERSION) return undefined;
    return entry.commonDir;
  }

  async set(repositoryPath: string, commonDir: string): Promise<void> {
    await this.memento.update(REPOSITORY_COMMON_DIR_CACHE_KEY, {
      ...this.all(),
      [repositoryPath]: {
        schemaVersion: REPOSITORY_COMMON_DIR_CACHE_SCHEMA_VERSION,
        commonDir,
      },
    });
  }

  async clear(repositoryPath: string): Promise<void> {
    const all = { ...this.all() };
    delete all[repositoryPath];
    await this.memento.update(REPOSITORY_COMMON_DIR_CACHE_KEY, all);
  }

  private all(): Record<string, RepositoryCommonDirCacheEntry> {
    return this.memento.get<Record<string, RepositoryCommonDirCacheEntry>>(
      REPOSITORY_COMMON_DIR_CACHE_KEY,
      {},
    );
  }
}

export type CommonDirCacheLike = Pick<RepositoryCommonDirCache, 'get' | 'set'>;

export const PASS_THROUGH_COMMON_DIR_CACHE: CommonDirCacheLike = {
  get: () => undefined,
  set: async () => undefined,
};

export async function resolveCommonDir(
  cache: CommonDirCacheLike,
  repositoryPath: string,
): Promise<string> {
  const cached = cache.get(repositoryPath);
  if (cached !== undefined) return cached;
  const commonDir = await getCommonDir(repositoryPath);
  await cache.set(repositoryPath, commonDir);
  return commonDir;
}

export async function resolveCommonDirSafe(
  cache: CommonDirCacheLike,
  repositoryPath: string,
): Promise<string | null> {
  const cached = cache.get(repositoryPath);
  if (cached !== undefined) return cached;
  const commonDir = await getCommonDirSafe(repositoryPath);
  if (commonDir !== null) await cache.set(repositoryPath, commonDir);
  return commonDir;
}
