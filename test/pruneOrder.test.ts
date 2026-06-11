import { describe, expect, it } from 'vitest';
import { pruneOrder } from '../src/tree/pruneOrder';
import { reconcileTerminalOrder } from '../src/tree/reconcileTerminalOrder';

describe('pruneOrder', () => {
  it('drops stored keys absent from the live set and reports drift', () => {
    expect(pruneOrder(['dead', 'live-a', 'live-b'], new Set(['live-a', 'live-b']))).toEqual({
      order: ['live-a', 'live-b'],
      changed: true,
    });
  });

  it('reports no drift when every stored key is live', () => {
    const storedOrder = ['live-a', 'live-b'];

    expect(pruneOrder(storedOrder, new Set(['live-a', 'live-b', 'new-live']))).toEqual({
      order: storedOrder,
      changed: false,
    });
  });

  it('lets a reused Terminal name append at the bottom after the dead slot was pruned', () => {
    const storedOrder = [
      'wt-_work_alpha__term-3',
      'wt-_work_alpha__term-1',
      'wt-_work_alpha__term-2',
    ];
    const pruned = pruneOrder(storedOrder, new Set([
      'wt-_work_alpha__term-1',
      'wt-_work_alpha__term-2',
    ]));

    expect(
      reconcileTerminalOrder(pruned.order, [
        { sessionName: 'wt-_work_alpha__term-1' },
        { sessionName: 'wt-_work_alpha__term-2' },
        { sessionName: 'wt-_work_alpha__term-3' },
      ]).map((session) => session.sessionName),
    ).toEqual([
      'wt-_work_alpha__term-1',
      'wt-_work_alpha__term-2',
      'wt-_work_alpha__term-3',
    ]);
  });
});
