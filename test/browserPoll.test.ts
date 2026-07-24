import { describe, expect, it, vi } from 'vitest';
import { BrowserPoll, type BrowserPollScheduler } from '../src/browser/browserPoll';
import type { CdpTarget } from '../src/browser/cdpClient';
import { previewPort } from '../src/browser/previewPort';

class ManualScheduler implements BrowserPollScheduler {
  private callbacks: Array<() => void> = [];
  setTimeout(callback: () => void): unknown {
    this.callbacks.push(callback);
    return this.callbacks.length;
  }
  clearTimeout(): void {}
  async tick(): Promise<void> {
    const callbacks = this.callbacks;
    this.callbacks = [];
    for (const callback of callbacks) callback();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const worktree = '/work/alpha';
const app = { name: 'app', portBase: 3000 };
const storybook = { name: 'storybook', portBase: 6006 };

function target(url: string): CdpTarget {
  return { id: 't', type: 'page', title: '', url };
}

describe('BrowserPoll', () => {
  it('marks a preview open when a target on its port is live, and notifies', async () => {
    const scheduler = new ManualScheduler();
    const changed = vi.fn();
    const poll = new BrowserPoll({
      worktrees: async () => [{ worktreePath: worktree, debugPort: 9400 }],
      previewsFor: () => [app, storybook],
      liveTargets: async () => [target(`http://localhost:${previewPort(worktree, app)}/`)],
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: () => undefined }),
      scheduler,
    });
    poll.onDidChange(changed);
    poll.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(poll.isOpen(worktree, 'app')).toBe(true);
    expect(poll.isOpen(worktree, 'storybook')).toBe(false);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('does not poll while the window is unfocused', async () => {
    const liveTargets = vi.fn(async () => []);
    const poll = new BrowserPoll({
      worktrees: async () => [{ worktreePath: worktree, debugPort: 9400 }],
      previewsFor: () => [app],
      liveTargets,
      isFocused: () => false,
      onDidChangeFocus: () => ({ dispose: () => undefined }),
      scheduler: new ManualScheduler(),
    });
    poll.start();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(liveTargets).not.toHaveBeenCalled();
  });

  it('fires again only when the open set changes', async () => {
    const scheduler = new ManualScheduler();
    let targets: CdpTarget[] = [target(`http://localhost:${previewPort(worktree, app)}/`)];
    const changed = vi.fn();
    const poll = new BrowserPoll({
      worktrees: async () => [{ worktreePath: worktree, debugPort: 9400 }],
      previewsFor: () => [app],
      liveTargets: async () => targets,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: () => undefined }),
      scheduler,
    });
    poll.onDidChange(changed);
    poll.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changed).toHaveBeenCalledTimes(1);

    await scheduler.tick(); // same set → no fire
    expect(changed).toHaveBeenCalledTimes(1);

    targets = []; // now closed → fire
    await scheduler.tick();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(poll.isOpen(worktree, 'app')).toBe(false);
  });
});
