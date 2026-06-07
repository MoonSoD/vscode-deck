import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  workspaceFolders: [{ uri: { fsPath: '/work/repo' } }],
}));

vi.mock('vscode', () => ({
  workspace: {
    get workspaceFolders() {
      return vscodeState.workspaceFolders;
    },
  },
}));

import { EditorTerminalHydrator } from '../src/terminal/editorTerminalHydrator';
import { TerminalSessionRegistry } from '../src/terminal/terminalSessionRegistry';

function terminal(name: string) {
  return {
    name,
    dispose: vi.fn(),
    show: vi.fn(),
  };
}

function createHydrator(options: {
  liveSessions?: string[];
  registry?: TerminalSessionRegistry;
}) {
  const tmux = {
    listSessions: vi.fn(async () =>
      (options.liveSessions ?? ['wt-_work_repo__term-1']).map((sessionName) => ({
        sessionName,
        windowName: 'zsh',
      })),
    ),
  };
  const registry = options.registry ?? new TerminalSessionRegistry();
  const hydrator = new EditorTerminalHydrator(tmux, registry);
  return { hydrator, registry, tmux };
}

describe('EditorTerminalHydrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vscodeState.workspaceFolders = [{ uri: { fsPath: '/work/repo' } }];
  });

  it('ignores terminals whose name does not match the Deck pattern', async () => {
    const { hydrator, registry, tmux } = createHydrator({});

    await hydrator.hydrateOne(terminal('zsh'));
    await hydrator.hydrateOne(terminal('tmux'));
    await hydrator.hydrateOne(terminal('plain text'));

    expect(tmux.listSessions).not.toHaveBeenCalled();
    expect(registry.get('wt-_work_repo__term-1')).toBeUndefined();
  });

  it('registers restored terminals when their tmux session is alive', async () => {
    const restored = terminal('1 zsh');
    const { hydrator, registry } = createHydrator({});

    await hydrator.hydrateOne(restored);

    expect(registry.get('wt-_work_repo__term-1')).toBe(restored);
    expect(restored.dispose).not.toHaveBeenCalled();
  });

  it('disposes restored terminals whose tmux session is gone', async () => {
    const restored = terminal('1 zsh');
    const { hydrator, registry } = createHydrator({ liveSessions: [] });

    await hydrator.hydrateOne(restored);

    expect(restored.dispose).toHaveBeenCalledOnce();
    expect(registry.get('wt-_work_repo__term-1')).toBeUndefined();
  });

  it('deduplicates collisions by disposing the later-arriving terminal', async () => {
    const first = terminal('1 zsh');
    const second = terminal('1 zsh');
    const { hydrator, registry } = createHydrator({});

    await hydrator.hydrateOne(first);
    await hydrator.hydrateOne(second);

    expect(registry.get('wt-_work_repo__term-1')).toBe(first);
    expect(first.dispose).not.toHaveBeenCalled();
    expect(second.dispose).toHaveBeenCalledOnce();
  });

  it('is idempotent when called repeatedly with the same terminal', async () => {
    const restored = terminal('1 zsh');
    const { hydrator, registry } = createHydrator({});

    await hydrator.hydrateOne(restored);
    await hydrator.hydrateOne(restored);

    expect(registry.get('wt-_work_repo__term-1')).toBe(restored);
    expect(restored.dispose).not.toHaveBeenCalled();
  });

  it('hydrates a snapshot of multiple terminals', async () => {
    const t1 = terminal('1 zsh');
    const t2 = terminal('2 claude');
    const orphan = terminal('3 zsh');
    const nonDeck = terminal('shell');
    const { hydrator, registry } = createHydrator({
      liveSessions: ['wt-_work_repo__term-1', 'wt-_work_repo__term-2'],
    });

    await hydrator.hydrateSnapshot([t1, t2, orphan, nonDeck]);

    expect(registry.get('wt-_work_repo__term-1')).toBe(t1);
    expect(registry.get('wt-_work_repo__term-2')).toBe(t2);
    expect(orphan.dispose).toHaveBeenCalledOnce();
    expect(nonDeck.dispose).not.toHaveBeenCalled();
  });
});
