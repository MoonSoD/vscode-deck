import { beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeState = vi.hoisted(() => ({
  activeTerminal: undefined as unknown,
  executeCommand: vi.fn(async () => undefined),
}));

vi.mock('vscode', () => ({
  window: {
    get activeTerminal() {
      return vscodeState.activeTerminal;
    },
  },
  commands: {
    executeCommand: vscodeState.executeCommand,
  },
}));

import { TerminalSessionRegistry, type TerminalLike } from '../src/terminal/terminalSessionRegistry';

describe('TerminalSessionRegistry', () => {
  beforeEach(() => {
    vscodeState.activeTerminal = undefined;
    vscodeState.executeCommand.mockClear();
  });

  it('tracks live terminals by session and removes them on close', () => {
    let closeListener: ((terminal: TerminalLike) => void) | undefined;
    const registry = new TerminalSessionRegistry((listener) => {
      closeListener = listener;
      return { dispose: vi.fn() };
    });
    const terminal = { show: vi.fn() };

    expect(registry.get('wt-_work_repo__term-1')).toBeUndefined();

    registry.set('wt-_work_repo__term-1', terminal);

    expect(registry.get('wt-_work_repo__term-1')).toBe(terminal);
    closeListener?.(terminal);
    expect(registry.get('wt-_work_repo__term-1')).toBeUndefined();
  });

  it('findSession returns the session name registered for a terminal', () => {
    const registry = new TerminalSessionRegistry();
    const terminal = { show: vi.fn() };
    registry.set('wt-_work_repo__term-2', terminal);

    expect(registry.findSession(terminal)).toBe('wt-_work_repo__term-2');
    expect(registry.findSession({ show: vi.fn() })).toBeUndefined();
  });

  it('renameIfActive runs the rename command only when the target is the active terminal', async () => {
    const registry = new TerminalSessionRegistry();
    const terminal = { show: vi.fn() };
    registry.set('wt-_work_repo__term-1', terminal);

    vscodeState.activeTerminal = { show: vi.fn() }; // different terminal
    await registry.renameIfActive('wt-_work_repo__term-1', '1 claude');
    expect(vscodeState.executeCommand).not.toHaveBeenCalled();

    vscodeState.activeTerminal = terminal;
    await registry.renameIfActive('wt-_work_repo__term-1', '1 claude');
    expect(vscodeState.executeCommand).toHaveBeenCalledWith(
      'workbench.action.terminal.renameWithArg',
      { name: '1 claude' },
    );
  });

  it('renameIfActive no-ops when the session is not registered', async () => {
    const registry = new TerminalSessionRegistry();
    vscodeState.activeTerminal = { show: vi.fn() };
    await registry.renameIfActive('unknown', '1 zsh');
    expect(vscodeState.executeCommand).not.toHaveBeenCalled();
  });

  it('renameIfActive swallows errors from the rename command', async () => {
    const registry = new TerminalSessionRegistry();
    const terminal = { show: vi.fn() };
    registry.set('wt-_work_repo__term-1', terminal);
    vscodeState.activeTerminal = terminal;
    vscodeState.executeCommand.mockRejectedValueOnce(new Error('gone'));

    await expect(
      registry.renameIfActive('wt-_work_repo__term-1', '1 claude'),
    ).resolves.toBeUndefined();
  });
});
