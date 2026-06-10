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
      message: 'Allow Bash(ls)?',
    });
    store.fire();
    await Promise.resolve();

    expect(notifications.showWarningMessage).toHaveBeenCalledOnce();
    expect(notifications.showWarningMessage).toHaveBeenCalledWith(
      'Allow Bash(ls)?',
      'Open Terminal',
    );
    expect(openTerminal).toHaveBeenCalledWith('wt-_work_repo__term-1');

    statuses.set('wt-_work_repo__term-1', {
      status: 'needsInput',
      statusAt: 1710000001,
      message: 'Allow Bash(ls)?',
    });
    store.fire();
    await Promise.resolve();

    expect(notifications.showWarningMessage).toHaveBeenCalledOnce();
    disposable.dispose();
  });

  it('does not notify when that Terminal tab is active', () => {
    const statuses = new Map<string, AgentStatus>();
    const store = new FakeStatusStore(statuses);
    const notifications = fakeNotifications();
    const notifier = createNotifier({
      store,
      notifications,
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

  it.each([
    ['off', true, false],
    ['windowNotFocused', true, false],
    ['windowNotFocused', false, false],
    ['always', true, true],
    ['always', false, false],
  ] as const)(
    'applies in-window notifyOnNeedsInput=%s while focused=%s',
    (mode, focused, expectedToast) => {
      const statuses = new Map<string, AgentStatus>();
      const store = new FakeStatusStore(statuses);
      const notifications = fakeNotifications();
      const osNotifications = fakeOsNotifications();
      const notifier = createNotifier({
        store,
        notifications,
        osNotifications,
        notifyOnNeedsInput: () => mode,
        isFocused: () => focused,
      });
      const disposable = notifier.start();

      statuses.set('wt-_work_repo__term-1', { status: 'needsInput', statusAt: 1710000000 });
      store.fire();

      expect(notifications.showWarningMessage).toHaveBeenCalledTimes(expectedToast ? 1 : 0);
      expect(osNotifications.notify).toHaveBeenCalledTimes(!focused && mode !== 'off' ? 1 : 0);
      disposable.dispose();
    },
  );

  it('posts a default-sound OS banner instead of a toast for needs input when the window is not focused', async () => {
    const statuses = new Map<string, AgentStatus>();
    const store = new FakeStatusStore(statuses);
    const notifications = fakeNotifications();
    const osNotifications = fakeOsNotifications();
    const notifier = createNotifier({
      store,
      notifications,
      osNotifications,
      notifyOnNeedsInput: () => 'windowNotFocused',
      isFocused: () => false,
    });
    const disposable = notifier.start();

    statuses.set('wt-_work_repo__term-1', {
      status: 'needsInput',
      statusAt: 1710000000,
      message: 'Allow Bash(ls)?',
    });
    store.fire();
    await Promise.resolve();

    expect(notifications.showWarningMessage).not.toHaveBeenCalled();
    expect(osNotifications.notify).toHaveBeenCalledWith(
      'wt-_work_repo__term-1',
      'Allow Bash(ls)?',
      'vscode://a9a4k.deck/open-terminal?session=wt-_work_repo__term-1',
      'default',
    );
    disposable.dispose();
  });

  it('keeps completed notifications off by default and sends info toasts when enabled', () => {
    const statuses = new Map<string, AgentStatus>();
    const store = new FakeStatusStore(statuses);
    const notifications = fakeNotifications();
    const notifier = createNotifier({ store, notifications });
    const disposable = notifier.start();

    statuses.set('wt-_work_repo__term-1', { status: 'completed', statusAt: 1710000000 });
    store.fire();

    expect(notifications.showInformationMessage).not.toHaveBeenCalled();

    statuses.set('wt-_work_repo__term-1', { status: 'inProgress', statusAt: 1710000001 });
    store.fire();
    disposable.dispose();

    const enabledNotifier = createNotifier({
      store,
      notifications,
      notifyOnCompleted: () => 'always',
    });
    const enabledDisposable = enabledNotifier.start();
    statuses.set('wt-_work_repo__term-1', {
      status: 'completed',
      statusAt: 1710000002,
      message: 'Claude stopped',
    });
    store.fire();

    expect(notifications.showInformationMessage).toHaveBeenCalledWith(
      'Claude stopped',
      'Open Terminal',
    );
    enabledDisposable.dispose();
  });

  it.each([
    ['off', true, false],
    ['windowNotFocused', true, false],
    ['windowNotFocused', false, false],
    ['always', true, true],
    ['always', false, false],
  ] as const)(
    'applies in-window notifyOnCompleted=%s while focused=%s',
    (mode, focused, expectedToast) => {
      const statuses = new Map<string, AgentStatus>();
      const store = new FakeStatusStore(statuses);
      const notifications = fakeNotifications();
      const osNotifications = fakeOsNotifications();
      const notifier = createNotifier({
        store,
        notifications,
        osNotifications,
        notifyOnCompleted: () => mode,
        isFocused: () => focused,
      });
      const disposable = notifier.start();

      statuses.set('wt-_work_repo__term-1', { status: 'completed', statusAt: 1710000000 });
      store.fire();

      expect(notifications.showInformationMessage).toHaveBeenCalledTimes(expectedToast ? 1 : 0);
      expect(osNotifications.notify).toHaveBeenCalledTimes(!focused && mode !== 'off' ? 1 : 0);
      disposable.dispose();
    },
  );

  it('posts a silent OS banner for completed when the window is not focused', async () => {
    const statuses = new Map<string, AgentStatus>();
    const store = new FakeStatusStore(statuses);
    const notifications = fakeNotifications();
    const osNotifications = fakeOsNotifications();
    const notifier = createNotifier({
      store,
      notifications,
      osNotifications,
      notifyOnCompleted: () => 'always',
      isFocused: () => false,
    });
    const disposable = notifier.start();

    statuses.set('wt-_work_repo__term-1', {
      status: 'completed',
      statusAt: 1710000000,
      message: 'Claude stopped',
    });
    store.fire();
    await Promise.resolve();

    expect(notifications.showInformationMessage).not.toHaveBeenCalled();
    expect(osNotifications.notify).toHaveBeenCalledWith(
      'wt-_work_repo__term-1',
      'Claude stopped',
      'vscode://a9a4k.deck/open-terminal?session=wt-_work_repo__term-1',
      undefined,
    );
    disposable.dispose();
  });

  it('clears the OS banner when a Terminal leaves needs input', () => {
    const statuses = new Map<string, AgentStatus>();
    const store = new FakeStatusStore(statuses);
    const osNotifications = fakeOsNotifications();
    const notifier = createNotifier({ store, osNotifications });
    const disposable = notifier.start();

    statuses.set('wt-_work_repo__term-1', { status: 'needsInput', statusAt: 1710000000 });
    store.fire();
    statuses.set('wt-_work_repo__term-1', { status: 'inProgress', statusAt: 1710000001 });
    store.fire();

    expect(osNotifications.clear).toHaveBeenCalledWith('wt-_work_repo__term-1');
    disposable.dispose();
  });

  it('clears the OS banner when a needs-input Terminal disappears', () => {
    const statuses = new Map<string, AgentStatus>();
    const store = new FakeStatusStore(statuses);
    const osNotifications = fakeOsNotifications();
    const notifier = createNotifier({ store, osNotifications });
    const disposable = notifier.start();

    statuses.set('wt-_work_repo__term-1', { status: 'needsInput', statusAt: 1710000000 });
    store.fire();
    statuses.delete('wt-_work_repo__term-1');
    store.fire();

    expect(osNotifications.clear).toHaveBeenCalledWith('wt-_work_repo__term-1');
    disposable.dispose();
  });

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
    statuses.set('wt-_work_repo__term-1', { status: 'inProgress', statusAt: 1710000001 });
    store.fire();
    selectAction?.('Open Terminal');
    await Promise.resolve();

    expect(openTerminal).toHaveBeenCalledWith('wt-_work_repo__term-1');
    disposable.dispose();
  });
});

function createNotifier(options: {
  store: FakeStatusStore;
  notifications?: ReturnType<typeof fakeNotifications>;
  osNotifications?: ReturnType<typeof fakeOsNotifications>;
  openTerminal?: (sessionName: string) => void | PromiseLike<void>;
  notifyOnNeedsInput?: () => 'off' | 'windowNotFocused' | 'always';
  notifyOnCompleted?: () => 'off' | 'windowNotFocused' | 'always';
  isFocused?: () => boolean;
  activeTerminalSessionName?: () => string | undefined;
}): AgentStatusNotifier {
  return new AgentStatusNotifier({
    store: options.store,
    settings: {
      notifyOnNeedsInput: options.notifyOnNeedsInput ?? (() => 'always'),
      notifyOnCompleted: options.notifyOnCompleted ?? (() => 'off'),
    },
    windowState: {
      isFocused: options.isFocused ?? (() => true),
      activeTerminalSessionName: options.activeTerminalSessionName ?? (() => undefined),
    },
    notifications: options.notifications ?? fakeNotifications(),
    osNotifications: options.osNotifications ?? fakeOsNotifications(),
    deepLink: (sessionName) => `vscode://a9a4k.deck/open-terminal?session=${sessionName}`,
    openTerminal: options.openTerminal ?? (async () => undefined),
  });
}

function fakeNotifications(choice?: string) {
  return {
    showWarningMessage: vi.fn(async () => choice),
    showInformationMessage: vi.fn(async () => choice),
  };
}

function fakeOsNotifications() {
  return {
    notify: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
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
