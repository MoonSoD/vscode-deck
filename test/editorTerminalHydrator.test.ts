import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  TabInputTerminal: class {
    constructor(public readonly terminal: unknown) {}
  },
  createTerminal: vi.fn(),
  tabGroups: { all: [] as unknown[] },
  workspaceFolders: [{ uri: { fsPath: '/work/repo' } }],
}));

vi.mock('vscode', () => ({
  window: {
    createTerminal: vscodeState.createTerminal,
    get tabGroups() {
      return vscodeState.tabGroups;
    },
  },
  TabInputTerminal: vscodeState.TabInputTerminal,
  workspace: {
    get workspaceFolders() {
      return vscodeState.workspaceFolders;
    },
  },
}));

import { EditorTerminalHydrator } from '../src/terminal/editorTerminalHydrator';
import { TerminalSessionRegistry } from '../src/terminal/terminalSessionRegistry';

function terminal(name: string, cwd: string, pid: number | undefined = 1000) {
  return {
    name,
    creationOptions: { cwd },
    processId: Promise.resolve(pid),
    dispose: vi.fn(),
    show: vi.fn(),
  };
}

function createHydrator(options: {
  liveSessions?: string[];
  stored?: Record<string, number | undefined>;
  registry?: TerminalSessionRegistry;
}) {
  const tmux = {
    listSessions: vi.fn(async () =>
      (options.liveSessions ?? ['wt-_work_repo__term-1']).map((sessionName) => ({
        sessionName,
        windowName: 'zsh',
      })),
    ),
    attachShellArgs: vi.fn((session: string) => ['attach-session', '-t', `=${session}`]),
  };
  const pidStore = {
    get: vi.fn((session: string) => options.stored?.[session]),
    set: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    prune: vi.fn(async () => undefined),
  };
  const registry = options.registry ?? new TerminalSessionRegistry();
  const hydrator = new EditorTerminalHydrator(tmux, registry, pidStore);
  return { hydrator, registry, tmux, pidStore };
}

describe('EditorTerminalHydrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/repo' } }];
    vscodeState.tabGroups = { all: [] };
    vscodeState.createTerminal.mockReturnValue({
      processId: Promise.resolve(2000),
      show: vi.fn(),
      dispose: vi.fn(),
    });
  });

  it('ignores non-Deck names and wrong worktree cwd', async () => {
    const { hydrator, registry, tmux } = createHydrator({});

    await hydrator.hydrateOne(terminal('zsh', '/work/repo'));
    await hydrator.hydrateOne(terminal('1 zsh', '/work/other'));

    expect(tmux.listSessions).not.toHaveBeenCalled();
    expect(registry.get('wt-_work_repo__term-1')).toBeUndefined();
  });

  it('disposes restored terminals whose tmux session is gone and removes their pid', async () => {
    const restored = terminal('1 zsh', '/work/repo');
    const { hydrator, pidStore } = createHydrator({ liveSessions: [] });

    await hydrator.hydrateOne(restored);

    expect(restored.dispose).toHaveBeenCalledOnce();
    expect(pidStore.remove).toHaveBeenCalledWith('wt-_work_repo__term-1');
  });

  it('registers restored terminals when the pid matches the stored pid', async () => {
    const restored = terminal('1 zsh', '/work/repo', 1234);
    const { hydrator, registry } = createHydrator({
      stored: { 'wt-_work_repo__term-1': 1234 },
    });

    await hydrator.hydrateOne(restored);

    expect(registry.get('wt-_work_repo__term-1')).toBe(restored);
    expect(restored.dispose).not.toHaveBeenCalled();
    expect(vscodeState.createTerminal).not.toHaveBeenCalled();
  });

  it('recreates restored terminals when the pid differs or is unknown', async () => {
    const restored = terminal('1 zsh', '/work/repo', 9999);
    vscodeState.tabGroups = {
      all: [
        {
          viewColumn: 2,
          tabs: [{ input: new vscodeState.TabInputTerminal(restored) }],
        },
      ],
    };
    const recreated = { processId: Promise.resolve(2222), show: vi.fn(), dispose: vi.fn() };
    vscodeState.createTerminal.mockReturnValue(recreated);
    const { hydrator, registry, pidStore, tmux } = createHydrator({
      stored: { 'wt-_work_repo__term-1': 1234 },
    });

    await hydrator.hydrateOne(restored);

    expect(vscodeState.createTerminal).toHaveBeenCalledWith({
      name: '1 zsh',
      shellPath: 'tmux',
      shellArgs: ['attach-session', '-t', '=wt-_work_repo__term-1'],
      location: { viewColumn: 2 },
    });
    expect(tmux.attachShellArgs).toHaveBeenCalledWith('wt-_work_repo__term-1');
    expect(restored.dispose).toHaveBeenCalledOnce();
    expect(registry.get('wt-_work_repo__term-1')).toBe(recreated);
    expect(pidStore.set).toHaveBeenCalledWith('wt-_work_repo__term-1', 2222);

    const unknownPid = terminal('1 zsh', '/work/repo', 9999);
    vscodeState.createTerminal.mockClear();
    const { hydrator: missingStored } = createHydrator({ stored: {} });
    await missingStored.hydrateOne(unknownPid);
    expect(unknownPid.dispose).toHaveBeenCalledOnce();
    expect(vscodeState.createTerminal).toHaveBeenCalledOnce();
  });

  it('handles registry collisions by swapping only when the restored pid matches', async () => {
    const existing = terminal('1 zsh', '/work/repo', 1111);
    const registry = new TerminalSessionRegistry();
    registry.set('wt-_work_repo__term-1', existing);
    const matching = terminal('1 zsh', '/work/repo', 1234);
    const { hydrator } = createHydrator({
      registry,
      stored: { 'wt-_work_repo__term-1': 1234 },
    });

    await hydrator.hydrateOne(matching);

    expect(existing.dispose).toHaveBeenCalledOnce();
    expect(registry.get('wt-_work_repo__term-1')).toBe(matching);

    const nonMatching = terminal('1 zsh', '/work/repo', 9999);
    await hydrator.hydrateOne(nonMatching);

    expect(nonMatching.dispose).toHaveBeenCalledOnce();
    expect(registry.get('wt-_work_repo__term-1')).toBe(matching);
  });

  it('prunes pid records after hydrating a snapshot', async () => {
    const { hydrator, pidStore } = createHydrator({
      liveSessions: ['wt-_work_repo__term-1'],
      stored: { 'wt-_work_repo__term-1': 1000 },
    });

    await hydrator.hydrateSnapshot([terminal('1 zsh', '/work/repo', 1000)]);

    expect(pidStore.prune).toHaveBeenCalledWith(['wt-_work_repo__term-1']);
  });
});
