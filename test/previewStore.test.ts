import { describe, expect, it, vi } from 'vitest';
import { PreviewStore } from '../src/browser/previewStore';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('PreviewStore', () => {
  it('returns [] on first read and caches after the background resolve, firing onDidChange', async () => {
    const resolve = vi.fn(async () => [{ name: 'app', portBase: 3000 }]);
    const store = new PreviewStore(resolve);
    const changed = vi.fn();
    store.onDidChange(changed);

    expect(store.forWorktree('/work/foo')).toEqual([]);
    await flush();

    expect(changed).toHaveBeenCalledOnce();
    expect(store.forWorktree('/work/foo')).toEqual([{ name: 'app', portBase: 3000 }]);
  });

  it('resolves each worktree once while a resolve is in flight', async () => {
    const resolve = vi.fn(async () => [{ name: 'app', portBase: 3000 }]);
    const store = new PreviewStore(resolve);

    store.forWorktree('/work/foo');
    store.forWorktree('/work/foo');
    await flush();

    expect(resolve).toHaveBeenCalledOnce();
  });

  it('invalidate clears the cache so edited config is re-resolved', async () => {
    let previews = [{ name: 'app', portBase: 3000 }];
    const store = new PreviewStore(async () => previews);
    store.forWorktree('/work/foo');
    await flush();

    previews = [{ name: 'app', portBase: 3000 }, { name: 'storybook', portBase: 6006 }];
    store.invalidate();
    expect(store.forWorktree('/work/foo')).toEqual([]);
    await flush();

    expect(store.forWorktree('/work/foo')).toHaveLength(2);
  });
});
