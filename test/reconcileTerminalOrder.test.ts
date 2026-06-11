import { describe, expect, it } from 'vitest';
import type { TmuxSession } from '../src/terminal/tmuxCli';
import { reconcileTerminalOrder } from '../src/tree/reconcileTerminalOrder';

function terminal(sessionName: string): TmuxSession {
  return { sessionName, windowName: sessionName };
}

describe('reconcileTerminalOrder', () => {
  it('returns live Terminals in ascending term-N order when no order is stored', () => {
    const liveSessions = [
      terminal('wt-_work_alpha__term-3'),
      terminal('wt-_work_alpha__term-1'),
      terminal('wt-_work_alpha__term-2'),
    ];

    expect(reconcileTerminalOrder(undefined, liveSessions).map((session) => session.sessionName)).toEqual([
      'wt-_work_alpha__term-1',
      'wt-_work_alpha__term-2',
      'wt-_work_alpha__term-3',
    ]);
  });

  it('honors stored order and appends unknown live Terminals in term-N order', () => {
    const liveSessions = [
      terminal('wt-_work_alpha__term-3'),
      terminal('wt-_work_alpha__term-1'),
      terminal('wt-_work_alpha__term-2'),
    ];

    expect(
      reconcileTerminalOrder(
        ['wt-_work_alpha__term-2', 'wt-_work_alpha__term-99'],
        liveSessions,
      ).map((session) => session.sessionName),
    ).toEqual([
      'wt-_work_alpha__term-2',
      'wt-_work_alpha__term-1',
      'wt-_work_alpha__term-3',
    ]);
  });

  it('drops stale stored Terminals while preserving kept order', () => {
    const liveSessions = [
      terminal('wt-_work_alpha__term-1'),
      terminal('wt-_work_alpha__term-2'),
      terminal('wt-_work_alpha__term-3'),
    ];

    expect(
      reconcileTerminalOrder(
        ['wt-_work_alpha__term-99', 'wt-_work_alpha__term-3', 'wt-_work_alpha__term-1'],
        liveSessions,
      ).map((session) => session.sessionName),
    ).toEqual([
      'wt-_work_alpha__term-3',
      'wt-_work_alpha__term-1',
      'wt-_work_alpha__term-2',
    ]);
  });
});
