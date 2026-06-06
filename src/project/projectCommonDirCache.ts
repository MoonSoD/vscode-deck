import type { MementoLike } from '../switch/activeWorktreeStore';

export const PROJECT_COMMON_DIR_CACHE_KEY = 'deck.projectCommonDirCache';
export const PROJECT_COMMON_DIR_CACHE_SCHEMA_VERSION = 1;

interface ProjectCommonDirCacheEntry {
  schemaVersion: number;
  commonDir: string;
}

export class ProjectCommonDirCache {
  constructor(private readonly memento: MementoLike) {}

  get(projectPath: string): string | undefined {
    const entry = this.all()[projectPath];
    if (entry?.schemaVersion !== PROJECT_COMMON_DIR_CACHE_SCHEMA_VERSION) return undefined;
    return entry.commonDir;
  }

  async set(projectPath: string, commonDir: string): Promise<void> {
    await this.memento.update(PROJECT_COMMON_DIR_CACHE_KEY, {
      ...this.all(),
      [projectPath]: {
        schemaVersion: PROJECT_COMMON_DIR_CACHE_SCHEMA_VERSION,
        commonDir,
      },
    });
  }

  async clear(projectPath: string): Promise<void> {
    const all = { ...this.all() };
    delete all[projectPath];
    await this.memento.update(PROJECT_COMMON_DIR_CACHE_KEY, all);
  }

  private all(): Record<string, ProjectCommonDirCacheEntry> {
    return this.memento.get<Record<string, ProjectCommonDirCacheEntry>>(
      PROJECT_COMMON_DIR_CACHE_KEY,
      {},
    );
  }
}
