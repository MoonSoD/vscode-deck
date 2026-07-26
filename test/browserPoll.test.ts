import { describe, expect, it, vi } from 'vitest';
import { BrowserPoll, type BrowserPollScheduler } from '../src/browser/browserPoll';
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
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('BrowserPoll', () => {
  it('marks a preview ON when its port is listening, and notifies', async () => {
    const appPort = previewPort(worktree, app);
    const changed = vi.fn();
    const poll = new BrowserPoll({
      previewEntries: () => [{ worktreePath: worktree, previews: [app, storybook] }],
      isPortListening: async (port) => port === appPort,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: () => undefined }),
      scheduler: new ManualScheduler(),
    });
    poll.onDidChange(changed);
    poll.start();
    await flush();

    expect(poll.isOn(worktree, 'app')).toBe(true);
    expect(poll.isOn(worktree, 'storybook')).toBe(false);
    expect(changed).toHaveBeenCalledOnce();
  });

  it('does not probe while the window is unfocused', async () => {
    const isPortListening = vi.fn(async () => false);
    const poll = new BrowserPoll({
      previewEntries: () => [{ worktreePath: worktree, previews: [app] }],
      isPortListening,
      isFocused: () => false,
      onDidChangeFocus: () => ({ dispose: () => undefined }),
      scheduler: new ManualScheduler(),
    });
    poll.start();
    await flush();
    expect(isPortListening).not.toHaveBeenCalled();
  });

  it('fires again only when the ON set changes', async () => {
    const scheduler = new ManualScheduler();
    const appPort = previewPort(worktree, app);
    let listening = true;
    const changed = vi.fn();
    const poll = new BrowserPoll({
      previewEntries: () => [{ worktreePath: worktree, previews: [app] }],
      isPortListening: async (port) => listening && port === appPort,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: () => undefined }),
      scheduler,
    });
    poll.onDidChange(changed);
    poll.start();
    await flush();
    expect(changed).toHaveBeenCalledTimes(1);

    await scheduler.tick(); // same set → no fire
    expect(changed).toHaveBeenCalledTimes(1);

    listening = false; // dev server stopped → fire
    await scheduler.tick();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(poll.isOn(worktree, 'app')).toBe(false);
  });
});
