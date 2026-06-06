import { describe, expect, it, vi } from 'vitest';
import { TerminalSessionRegistry, type TerminalLike } from '../src/terminal/terminalSessionRegistry';

describe('TerminalSessionRegistry', () => {
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
});
