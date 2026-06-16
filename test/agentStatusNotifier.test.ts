import { describe, expect, it, vi } from 'vitest';
import { AgentStatusNotifier } from '../src/agent/agentStatusNotifier';
import type { AgentStatus } from '../src/agent/agentStatusStore';

describe('AgentStatusNotifier', () => {
  it('does not notify for statuses already present when it starts', () => {
    const store = new FakeStatusStore(new Map([
      ['wt-_work_repo__term-1', {
        status: 'needsInput',
        statusAt: 1710000000,
        message: 'Allow Bash(ls)?',
      }],
    ]));
    const notifications = fakeNotifications();

    const notifier = createNotifier({ store, notifications });
    const disposable = notifier.start();
    store.fire();

    expect(notifications.showWarningMessage).not.toHaveBeenCalled();
    expect(notifications.showInformationMessage).not.toHaveBeenCalled();
    disposable.dispose();
  });

  it('warns once when a Terminal transitions into needs input and opens it from the action', async () => {
    const statuses = new Map<string, AgentStatus>();
    const store = new FakeStatusStore(statuses);
    const notifications = fakeNotifications('Open Terminal');
    const openTerminal = vi.fn(async () => undefined);
    const notifier = createNotifier({ store, notifications, openTerminal });
    const disposable = notifier.start();

    statuses.set('wt-_work_repo__term-1', {
      status: 'needsInput',
      statusAt: 1710000000,
      agent: 'claude',
      message: 'Allow Bash(ls)?',
    });
    store.fire();

    await vi.waitFor(() => {
      expect(notifications.showWarningMessage).toHaveBeenCalledOnce();
    });
    expect(notifications.showWarningMessage).toHaveBeenCalledWith(
      '⚠ claude · Allow Bash(ls)?',
      'Open Terminal',
    );
    await vi.waitFor(() => {
      expect(openTerminal).toHaveBeenCalledWith('wt-_work_repo__term-1');
    });

    statuses.set('wt-_work_repo__term-1', {
      status: 'needsInput',
      statusAt: 1710000001,
      message: 'Allow Bash(ls)?',
    });
    store.fire();

    expect(notifications.showWarningMessage).toHaveBeenCalledOnce();
    disposable.dispose();
  });

  it('identifies a needs-input agent by its tree labels', async () => {
    const statuses = new Map<string, AgentStatus>();
    const store = new FakeStatusStore(statuses);
    const notifications = fakeNotifications('Open Terminal');
    const openTerminal = vi.fn(async () => undefined);
    const notifier = createNotifier({
      store,
      notifications,
      openTerminal,
      resolveTerminalSession: async () => ({
        sessionName: 'wt-_work_alpha-main__term-1',
        windowName: 'claude',
        paneTitle: '✳ fix-dlq-requeue-uploads-deadline',
      }),
      describeSession: async () => ({ repo: 'vscode-deck', branch: 'main' }),
    });
    const disposable = notifier.start();

    statuses.set('wt-_work_alpha-main__term-1', {
      status: 'needsInput',
      statusAt: 1710000000,
      agent: 'claude',
      message: 'Claude needs your permission to use Bash',
    });
    store.fire();

    await vi.waitFor(() => {
      expect(notifications.showWarningMessage).toHaveBeenCalledWith(
        '⚠ vscode-deck/main · fix-dlq-requeue-uploads-deadline · Claude needs your permission to use Bash',
        'Open Terminal',
      );
    });
    await vi.waitFor(() => {
      expect(openTerminal).toHaveBeenCalledWith('wt-_work_alpha-main__term-1');
    });
    disposable.dispose();
  });

  it('falls back to the status agent when the AgentTitle is not available yet', async () => {
    const statuses = new Map<string, AgentStatus>();
    const store = new FakeStatusStore(statuses);
    const notifications = fakeNotifications();
    const notifier = createNotifier({
      store,
      notifications,
      resolveTerminalSession: async () => ({
        sessionName: 'wt-_work_alpha-main__term-1',
        windowName: 'zsh',
      }),
      describeSession: async () => ({ repo: 'vscode-deck', branch: 'main' }),
    });
    const disposable = notifier.start();

    statuses.set('wt-_work_alpha-main__term-1', {
      status: 'completed',
      statusAt: 1710000000,
      agent: 'codex',
    });
    store.fire();

    await vi.waitFor(() => {
      expect(notifications.showInformationMessage).toHaveBeenCalledWith(
        'ⓘ vscode-deck/main · codex · finished',
        'Open Terminal',
      );
    });
    disposable.dispose();
  });

  it('does not notify when that Terminal tab is active and the window is focused', () => {
    const statuses = new Map<string, AgentStatus>();
    const store = new FakeStatusStore(statuses);
    const notifications = fakeNotifications();
    const notifier = createNotifier({
      store,
      notifications,
      isFocused: () => true,
      activeTerminalSessionName: () => 'wt-_work_repo__term-1',
    });
    const disposable = notifier.start();

    statuses.set('wt-_work_repo__term-1', {
      status: 'needsInput',
      statusAt: 1710000000,
      message: 'Allow Bash(ls)?',
    });
    store.fire();

    expect(notifications.showWarningMessage).not.toHaveBeenCalled();
    disposable.dispose();
  });

  it('notifies for the active Terminal tab when the window is unfocused (you are away)', async () => {
    const statuses = new Map<string, AgentStatus>();
    const store = new FakeStatusStore(statuses);
    const notifications = fakeNotifications();
    const notifier = createNotifier({
      store,
      notifications,
      isFocused: () => false,
      activeTerminalSessionName: () => 'wt-_work_repo__term-1',
    });
    const disposable = notifier.start();

    statuses.set('wt-_work_repo__term-1', {
      status: 'needsInput',
      statusAt: 1710000000,
      message: 'Allow Bash(ls)?',
    });
    store.fire();

    await vi.waitFor(() => {
      expect(notifications.showWarningMessage).toHaveBeenCalledOnce();
    });
    disposable.dispose();
  });

  it.each([
    [true, true],
    [false, false],
  ] as const)(
    'applies notifyOnNeedsInput=%s',
    async (enabled, expectedToast) => {
      const statuses = new Map<string, AgentStatus>();
      const store = new FakeStatusStore(statuses);
      const notifications = fakeNotifications();
      const notifier = createNotifier({
        store,
        notifications,
        notifyOnNeedsInput: () => enabled,
      });
      const disposable = notifier.start();

      statuses.set('wt-_work_repo__term-1', { status: 'needsInput', statusAt: 1710000000 });
      store.fire();

      if (expectedToast) {
        await vi.waitFor(() => {
          expect(notifications.showWarningMessage).toHaveBeenCalledOnce();
        });
      } else {
        expect(notifications.showWarningMessage).not.toHaveBeenCalled();
      }
      disposable.dispose();
    },
  );

  it('sends completed info toasts by default and suppresses them when disabled', async () => {
    const statuses = new Map<string, AgentStatus>();
    const store = new FakeStatusStore(statuses);
    const notifications = fakeNotifications();
    const notifier = createNotifier({ store, notifications });
    const disposable = notifier.start();

    statuses.set('wt-_work_repo__term-1', {
      status: 'completed',
      statusAt: 1710000000,
      agent: 'claude',
      message: 'Claude stopped',
    });
    store.fire();

    await vi.waitFor(() => {
      expect(notifications.showInformationMessage).toHaveBeenCalledWith(
        'ⓘ claude · Claude stopped',
        'Open Terminal',
      );
    });
    disposable.dispose();

    const offNotifications = fakeNotifications();
    const offNotifier = createNotifier({
      store,
      notifications: offNotifications,
      notifyOnCompleted: () => false,
    });
    const offDisposable = offNotifier.start();
    statuses.set('wt-_work_repo__term-2', { status: 'completed', statusAt: 1710000001 });
    store.fire();

    expect(offNotifications.showInformationMessage).not.toHaveBeenCalled();
    offDisposable.dispose();
  });

  it.each([
    [true, true],
    [false, false],
  ] as const)(
    'applies notifyOnCompleted=%s',
    async (enabled, expectedToast) => {
      const statuses = new Map<string, AgentStatus>();
      const store = new FakeStatusStore(statuses);
      const notifications = fakeNotifications();
      const notifier = createNotifier({
        store,
        notifications,
        notifyOnCompleted: () => enabled,
      });
      const disposable = notifier.start();

      statuses.set('wt-_work_repo__term-1', { status: 'completed', statusAt: 1710000000 });
      store.fire();

      if (expectedToast) {
        await vi.waitFor(() => {
          expect(notifications.showInformationMessage).toHaveBeenCalledOnce();
        });
      } else {
        expect(notifications.showInformationMessage).not.toHaveBeenCalled();
      }
      disposable.dispose();
    },
  );

  it('opens the Terminal from a stale toast after the status has cleared', async () => {
    const statuses = new Map<string, AgentStatus>();
    const store = new FakeStatusStore(statuses);
    let selectAction: ((value: string | undefined) => void) | undefined;
    const notifications = {
      showWarningMessage: vi.fn(
        () => new Promise<string | undefined>((resolve) => {
          selectAction = resolve;
        }),
      ),
      showInformationMessage: vi.fn(),
    };
    const openTerminal = vi.fn(async () => undefined);
    const notifier = createNotifier({ store, notifications, openTerminal });
    const disposable = notifier.start();

    statuses.set('wt-_work_repo__term-1', { status: 'needsInput', statusAt: 1710000000 });
    store.fire();
    await vi.waitFor(() => {
      expect(notifications.showWarningMessage).toHaveBeenCalledOnce();
    });
    statuses.set('wt-_work_repo__term-1', { status: 'inProgress', statusAt: 1710000001 });
    store.fire();
    selectAction?.('Open Terminal');

    await vi.waitFor(() => {
      expect(openTerminal).toHaveBeenCalledWith('wt-_work_repo__term-1');
    });
    disposable.dispose();
  });
});

function createNotifier(options: {
  store: FakeStatusStore;
  notifications?: ReturnType<typeof fakeNotifications>;
  openTerminal?: (sessionName: string) => void | PromiseLike<void>;
  resolveTerminalSession?: (sessionName: string) => Promise<{
    sessionName: string;
    windowName: string;
    paneTitle?: string;
  } | undefined>;
  describeSession?: (sessionName: string) => Promise<{ repo: string; branch: string } | undefined>;
  notifyOnNeedsInput?: () => boolean;
  notifyOnCompleted?: () => boolean;
  isFocused?: () => boolean;
  activeTerminalSessionName?: () => string | undefined;
}): AgentStatusNotifier {
  return new AgentStatusNotifier({
    store: options.store,
    settings: {
      notifyOnNeedsInput: options.notifyOnNeedsInput ?? (() => true),
      notifyOnCompleted: options.notifyOnCompleted ?? (() => true),
    },
    windowState: {
      isFocused: options.isFocused ?? (() => true),
      activeTerminalSessionName: options.activeTerminalSessionName ?? (() => undefined),
    },
    notifications: options.notifications ?? fakeNotifications(),
    openTerminal: options.openTerminal ?? (async () => undefined),
    resolveTerminalSession: options.resolveTerminalSession ?? (async () => undefined),
    describeSession: options.describeSession ?? (async () => undefined),
  });
}

function fakeNotifications(choice?: string) {
  return {
    showWarningMessage: vi.fn(async () => choice),
    showInformationMessage: vi.fn(async () => choice),
  };
}

class FakeStatusStore {
  private listener: (() => void) | undefined;

  constructor(private readonly statuses: Map<string, AgentStatus>) {}

  entries(): IterableIterator<[string, AgentStatus]> {
    return this.statuses.entries();
  }

  onDidChange(listener: () => void): { dispose(): void } {
    this.listener = listener;
    return {
      dispose: () => {
        this.listener = undefined;
      },
    };
  }

  fire(): void {
    this.listener?.();
  }
}
