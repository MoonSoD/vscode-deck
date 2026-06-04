import type { MementoLike } from '../switch/activeWorktreeStore';

export const WORKTREE_ORDERS_KEY = 'deck.worktreeOrders';

export class WorktreeOrderStore {
  constructor(private readonly memento: MementoLike) {}

  get(commonDir: string): string[] | undefined {
    return this.all()[commonDir];
  }

  async set(commonDir: string, paths: readonly string[]): Promise<void> {
    await this.memento.update(WORKTREE_ORDERS_KEY, {
      ...this.all(),
      [commonDir]: [...paths],
    });
  }

  async clear(commonDir: string): Promise<void> {
    const all = { ...this.all() };
    delete all[commonDir];
    await this.memento.update(WORKTREE_ORDERS_KEY, all);
  }

  private all(): Record<string, string[]> {
    return this.memento.get<Record<string, string[]>>(WORKTREE_ORDERS_KEY, {});
  }
}
