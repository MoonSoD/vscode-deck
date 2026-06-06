export const ACTIVE_WORKTREES_KEY = 'deck.activeWorktrees';

type MaybePromise<T> = T | PromiseLike<T>;

export interface MementoLike {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): MaybePromise<void>;
}

export class ActiveWorktreeStore {
  constructor(private readonly memento: MementoLike) {}

  get(commonDir: string): string | undefined {
    return this.all()[commonDir];
  }

  async set(commonDir: string, worktreePath: string): Promise<void> {
    await this.memento.update(ACTIVE_WORKTREES_KEY, {
      ...this.all(),
      [commonDir]: worktreePath,
    });
  }

  async clear(commonDir: string): Promise<void> {
    const all = { ...this.all() };
    delete all[commonDir];
    await this.memento.update(ACTIVE_WORKTREES_KEY, all);
  }

  private all(): Record<string, string> {
    return this.memento.get<Record<string, string>>(ACTIVE_WORKTREES_KEY, {});
  }
}
