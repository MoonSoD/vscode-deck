import { describe, expect, it } from 'vitest';
import { PaneQuiescence } from '../src/agent/agentPaneQuiescence';

describe('PaneQuiescence', () => {
  it('reports quiescent only after the same capture spans the full window', () => {
    let now = 1000;
    const quiescence = new PaneQuiescence({ windowMs: 10000, now: () => now });

    expect(quiescence.accept('term-1', 'idle prompt')).toBe(false);
    now += 5000;
    expect(quiescence.accept('term-1', 'idle prompt')).toBe(false);
    now += 5000;
    expect(quiescence.accept('term-1', 'idle prompt')).toBe(true);
  });

  it('resets the window when the capture changes', () => {
    let now = 1000;
    const quiescence = new PaneQuiescence({ windowMs: 10000, now: () => now });

    expect(quiescence.accept('term-1', 'frame 1')).toBe(false);
    now += 9000;
    expect(quiescence.accept('term-1', 'frame 2')).toBe(false);
    now += 9000;
    expect(quiescence.accept('term-1', 'frame 2')).toBe(false);
    now += 1000;
    expect(quiescence.accept('term-1', 'frame 2')).toBe(true);
  });

  it('forgets a session capture', () => {
    let now = 1000;
    const quiescence = new PaneQuiescence({ windowMs: 10000, now: () => now });

    expect(quiescence.accept('term-1', 'idle prompt')).toBe(false);
    now += 10000;
    quiescence.forget('term-1');

    expect(quiescence.accept('term-1', 'idle prompt')).toBe(false);
  });
});
