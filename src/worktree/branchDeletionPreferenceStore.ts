import type { MementoLike } from '../switch/activeWorktreeStore';

export const DELETE_BRANCH_BY_DEFAULT_KEY = 'deck.deleteBranchByDefault';

export class BranchDeletionPreferenceStore {
  constructor(private readonly memento: MementoLike) {}

  get(): boolean {
    return this.memento.get(DELETE_BRANCH_BY_DEFAULT_KEY, false);
  }

  async set(value: boolean): Promise<void> {
    await this.memento.update(DELETE_BRANCH_BY_DEFAULT_KEY, value);
  }
}
