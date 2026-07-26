import type { PreviewDefinition } from './previewDefinition';

export interface Disposable {
  dispose(): void;
}

// The set of PreviewDefinitions for each Worktree, resolved from config
// (committed `.deck/previews.json` + settings). The tree reads it synchronously
// per Worktree row, so resolution is lazy-and-cached: the first read for a
// Worktree returns `[]` and kicks off a background resolve, then fires
// onDidChange so the subtree re-renders and reads the now-cached value — the same
// lazy pattern the tree already uses for common dirs. `invalidate()` clears the
// cache (on a config change or window refocus) so edits to `.deck/previews.json`
// are picked up. The counterpart to ChatSessionStore, keyed by Worktree.
export class PreviewStore {
  private readonly cache = new Map<string, readonly PreviewDefinition[]>();
  private readonly resolving = new Set<string>();
  private readonly listeners = new Set<() => void>();

  constructor(
    private readonly resolve: (worktreePath: string) => Promise<PreviewDefinition[]>,
  ) {}

  forWorktree(worktreePath: string): readonly PreviewDefinition[] {
    const cached = this.cache.get(worktreePath);
    if (cached !== undefined) return cached;
    this.resolveInBackground(worktreePath);
    return [];
  }

  // The worktrees resolved so far and their previews — how the BrowserPoll knows
  // which (Worktree, preview) ports to probe. Only worktrees the tree has already
  // rendered are cached; that is exactly the set worth probing.
  entries(): { worktreePath: string; previews: readonly PreviewDefinition[] }[] {
    return [...this.cache].map(([worktreePath, previews]) => ({ worktreePath, previews }));
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  invalidate(): void {
    if (this.cache.size === 0) return;
    this.cache.clear();
    this.fire();
  }

  private resolveInBackground(worktreePath: string): void {
    if (this.resolving.has(worktreePath)) return;
    this.resolving.add(worktreePath);
    void this.resolve(worktreePath)
      .then((previews) => {
        this.cache.set(worktreePath, previews);
        this.fire();
      })
      .catch(() => {
        this.cache.set(worktreePath, []);
      })
      .finally(() => {
        this.resolving.delete(worktreePath);
      });
  }

  private fire(): void {
    for (const listener of this.listeners) listener();
  }
}
