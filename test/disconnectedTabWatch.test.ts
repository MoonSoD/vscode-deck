import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  window: {
    tabGroups: {
      all: [],
      onDidChangeTabs: vi.fn(() => ({ dispose: vi.fn() })),
      close: vi.fn(async () => true),
    },
    showWarningMessage: vi.fn(),
  },
  commands: {
    executeCommand: vi.fn(async () => undefined),
  },
}));

import { DisconnectedTabWatch, type DisconnectedTabWatchSurface } from '../src/terminal/disconnectedTabWatch';

describe('DisconnectedTabWatch', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('badges and prompts only after an active Deck tab stays unwired past grace', async () => {
    const surface = new FakeSurface([tab('term-1', true)]);
    const notifications = fakeNotifications(undefined);
    const reopen = vi.fn(async () => undefined);
    const watch = createWatch(surface, { notifications, reopen });
    const changed: unknown[][] = [];
    watch.onDidChangeDisconnectedTabs((uris) => changed.push([...uris]));

    watch.start();
    await vi.advanceTimersByTimeAsync(999);
    expect(watch.isDisconnected('term-1')).toBe(false);
    expect(notifications.showWarningMessage).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);

    expect(watch.isDisconnected('term-1')).toBe(true);
    expect(changed).toEqual([[{ scheme: 'deck-terminal', path: '/repo/term-1' }]]);
    expect(notifications.showWarningMessage).toHaveBeenCalledWith(
      'Deck Terminal tabs were disconnected by an extension restart.',
      'Reopen Terminals',
    );
    await Promise.resolve();
    expect(reopen).not.toHaveBeenCalled();
  });

  it('does not badge a tab that resolves within the grace window', async () => {
    const surface = new FakeSurface([tab('term-1', true)]);
    const panels = new Set<string>();
    const watch = createWatch(surface, { panelFor: (sessionName) => panels.has(sessionName) ? {} : undefined });

    watch.start();
    await vi.advanceTimersByTimeAsync(500);
    panels.add('term-1');
    await vi.advanceTimersByTimeAsync(500);

    expect(watch.isDisconnected('term-1')).toBe(false);
  });

  it('runs the reopen flow when the notification action is selected', async () => {
    const surface = new FakeSurface([tab('term-1', true)]);
    const notifications = fakeNotifications('Reopen Terminals');
    const reopen = vi.fn(async () => undefined);
    const watch = createWatch(surface, { notifications, reopen });

    watch.start();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();

    expect(reopen).toHaveBeenCalledOnce();
    expect(watch.isDisconnected('term-1')).toBe(false);
  });

  it('re-offers the reopen action when a badged tab is activated after the throttle', async () => {
    const surface = new FakeSurface([tab('term-1', true)]);
    const notifications = fakeNotifications(undefined);
    const watch = createWatch(surface, { notifications });

    watch.start();
    await vi.advanceTimersByTimeAsync(1000);
    expect(notifications.showWarningMessage).toHaveBeenCalledOnce();

    surface.fireTabsChanged();
    await vi.advanceTimersByTimeAsync(500);
    expect(notifications.showWarningMessage).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(30_000);
    surface.fireTabsChanged();
    await vi.advanceTimersByTimeAsync(500);

    expect(notifications.showWarningMessage).toHaveBeenCalledTimes(2);
  });

  it('forgets a disconnected tab when the user closes it', async () => {
    const surface = new FakeSurface([tab('term-1', true)]);
    const watch = createWatch(surface);
    const changed: unknown[][] = [];
    watch.onDidChangeDisconnectedTabs((uris) => changed.push([...uris]));

    watch.start();
    await vi.advanceTimersByTimeAsync(1000);
    surface.close('term-1');

    expect(watch.isDisconnected('term-1')).toBe(false);
    expect(changed.at(-1)).toEqual([{ scheme: 'deck-terminal', path: '/repo/term-1' }]);
  });
});

function createWatch(
  surface: FakeSurface,
  overrides: Partial<ConstructorParameters<typeof DisconnectedTabWatch>[0]> = {},
): DisconnectedTabWatch {
  return new DisconnectedTabWatch({
    surface,
    panelFor: () => undefined,
    notifications: fakeNotifications(undefined),
    reopen: vi.fn(async () => undefined),
    ...overrides,
  });
}

function fakeNotifications(choice?: string) {
  return {
    showWarningMessage: vi.fn(async () => choice),
  };
}

function tab(sessionName: string, isActive: boolean) {
  return {
    sessionName,
    uri: { scheme: 'deck-terminal', path: `/repo/${sessionName}` } as never,
    isActive,
  };
}

class FakeSurface implements DisconnectedTabWatchSurface {
  private listener: ((event: { closedSessionNames: readonly string[] }) => void) | undefined;

  constructor(private readonly tabs: Array<ReturnType<typeof tab>>) {}

  activeDeckTabs(): ReturnType<typeof tab>[] {
    return this.tabs.filter((candidate) => candidate.isActive);
  }

  onDidChangeTabs(listener: (event: { closedSessionNames: readonly string[] }) => void) {
    this.listener = listener;
    return { dispose: vi.fn() };
  }

  fireTabsChanged(): void {
    this.listener?.({ closedSessionNames: [] });
  }

  close(sessionName: string): void {
    const index = this.tabs.findIndex((candidate) => candidate.sessionName === sessionName);
    if (index !== -1) this.tabs.splice(index, 1);
    this.listener?.({ closedSessionNames: [sessionName] });
  }
}
