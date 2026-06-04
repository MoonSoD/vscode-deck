export const ACTIVE_WORKTREES_KEY = 'deck.activeWorktrees';
export const FOCUS_DECK_AFTER_RELOAD_KEY = 'deck.focusDeckAfterReload';

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

  async setFocusIntent(value: boolean): Promise<void> {
    await this.memento.update(FOCUS_DECK_AFTER_RELOAD_KEY, value);
  }

  async consumeFocusIntent(): Promise<boolean> {
    const shouldFocus = this.memento.get(FOCUS_DECK_AFTER_RELOAD_KEY, false);
    if (shouldFocus) {
      await this.setFocusIntent(false);
    }
    return shouldFocus;
  }

  private all(): Record<string, string> {
    return this.memento.get<Record<string, string>>(ACTIVE_WORKTREES_KEY, {});
  }
}
