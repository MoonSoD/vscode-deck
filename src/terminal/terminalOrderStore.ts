import type { MementoLike } from '../switch/activeWorktreeStore';

export const TERMINAL_ORDERS_KEY = 'deck.terminalOrders';

export class TerminalOrderStore {
  constructor(private readonly memento: MementoLike) {}

  get(worktreePath: string): string[] | undefined {
    return this.all()[worktreePath];
  }

  async set(worktreePath: string, sessionNames: readonly string[]): Promise<void> {
    await this.memento.update(TERMINAL_ORDERS_KEY, {
      ...this.all(),
      [worktreePath]: [...sessionNames],
    });
  }

  async clear(worktreePath: string): Promise<void> {
    const all = { ...this.all() };
    delete all[worktreePath];
    await this.memento.update(TERMINAL_ORDERS_KEY, all);
  }

  private all(): Record<string, string[]> {
    return this.memento.get<Record<string, string[]>>(TERMINAL_ORDERS_KEY, {});
  }
}
