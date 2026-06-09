import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  createFileSystemWatcher: vi.fn(),
  patterns: [] as Array<{ baseUri: { fsPath: string }; pattern: string }>,
  watchers: [] as Array<{
    dispose: ReturnType<typeof vi.fn>;
    onDidCreate: ReturnType<typeof vi.fn>;
    onDidChange: ReturnType<typeof vi.fn>;
    onDidDelete: ReturnType<typeof vi.fn>;
    handlers: Array<() => void>;
  }>,
}));

vi.mock('vscode', () => ({
  RelativePattern: class {
    constructor(public readonly baseUri: { fsPath: string }, public readonly pattern: string) {
      vscodeState.patterns.push({ baseUri, pattern });
    }
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
  workspace: {
    createFileSystemWatcher: vscodeState.createFileSystemWatcher,
  },
}));

import { watchGitCommonDir } from '../src/repository/vscodeExternalGitWatch';

describe('watchGitCommonDir', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vscodeState.patterns = [];
    vscodeState.watchers = [];
    vscodeState.createFileSystemWatcher.mockImplementation(() => {
      const watcher = {
        dispose: vi.fn(),
        onDidCreate: vi.fn((handler: () => void) => {
          watcher.handlers.push(handler);
          return { dispose: vi.fn() };
        }),
        onDidChange: vi.fn((handler: () => void) => {
          watcher.handlers.push(handler);
          return { dispose: vi.fn() };
        }),
        onDidDelete: vi.fn((handler: () => void) => {
          watcher.handlers.push(handler);
          return { dispose: vi.fn() };
        }),
        handlers: [] as Array<() => void>,
      };
      vscodeState.watchers.push(watcher);
      return watcher;
    });
  });

  it('watches git HEAD paths and coalesces bursts into one refresh', () => {
    const refresh = vi.fn();

    watchGitCommonDir('/git/alpha', refresh);
    vscodeState.watchers[0].handlers[0]();
    vscodeState.watchers[1].handlers[1]();
    vi.advanceTimersByTime(249);

    expect(refresh).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(vscodeState.patterns).toEqual([
      { baseUri: { fsPath: '/git/alpha' }, pattern: 'HEAD' },
      { baseUri: { fsPath: '/git/alpha' }, pattern: 'worktrees/**/HEAD' },
      { baseUri: { fsPath: '/git/alpha' }, pattern: 'worktrees/*' },
    ]);
    expect(refresh).toHaveBeenCalledOnce();

    vscodeState.watchers[2].handlers[2]();
    vi.advanceTimersByTime(250);

    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
