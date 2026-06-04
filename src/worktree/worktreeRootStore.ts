import type { MementoLike } from '../switch/activeWorktreeStore';

export const WORKTREE_ROOTS_KEY = 'deck.worktreeRoots';

export class WorktreeRootStore {
  constructor(private readonly memento: MementoLike) {}

  get(commonDir: string): string | undefined {
    return this.all()[commonDir];
  }

  async set(commonDir: string, rootPath: string): Promise<void> {
    await this.memento.update(WORKTREE_ROOTS_KEY, {
      ...this.all(),
      [commonDir]: rootPath,
    });
  }

  private all(): Record<string, string> {
    return this.memento.get<Record<string, string>>(WORKTREE_ROOTS_KEY, {});
  }
}
