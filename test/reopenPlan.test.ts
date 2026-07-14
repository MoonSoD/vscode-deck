import { describe, expect, it } from 'vitest';
import { planReopenUnwiredTerminalTabs, type ReopenPlanSnapshot } from '../src/terminal/reopenPlan';

describe('planReopenUnwiredTerminalTabs', () => {
  it('reopens hidden unwired tabs before the active one and restores focus last', () => {
    const snapshot: ReopenPlanSnapshot = {
      groups: [{
        id: 'group-1',
        viewColumn: 1,
        isActive: true,
        activeTabId: 'term-2',
        tabs: [
          terminalTab('term-1', 0, { unwired: true, pinned: true }),
          terminalTab('term-2', 1, { active: true, unwired: true }),
        ],
      }],
    };

    expect(planReopenUnwiredTerminalTabs(snapshot)).toEqual([
      { kind: 'close', tabId: 'term-1' },
      { kind: 'open', tabId: 'term-1', uri: '/repo/term-1', viewColumn: 1 },
      { kind: 'move', tabId: 'term-1', index: 0 },
      { kind: 'pin', tabId: 'term-1' },
      { kind: 'close', tabId: 'term-2' },
      { kind: 'open', tabId: 'term-2', uri: '/repo/term-2', viewColumn: 1 },
      { kind: 'move', tabId: 'term-2', index: 1 },
      {
        kind: 'reveal',
        tabId: 'term-2',
        uri: '/repo/term-2',
        viewColumn: 1,
        viewType: 'deck.terminal',
        reason: 'restore-focus',
      },
    ]);
  });

  it('skips a group whose active tab cannot be restored afterwards', () => {
    const snapshot: ReopenPlanSnapshot = {
      groups: [{
        id: 'group-1',
        viewColumn: 1,
        isActive: true,
        activeTabId: 'webview',
        tabs: [
          {
            id: 'webview',
            index: 0,
            isActive: true,
            isPinned: false,
            isDeckTerminal: false,
            isUnwired: false,
            canReveal: false,
          },
          terminalTab('term-1', 1, { unwired: true }),
        ],
      }],
    };

    expect(planReopenUnwiredTerminalTabs(snapshot)).toEqual([]);
  });

  it('re-reveals a restorable active non-terminal tab after reopening hidden tabs', () => {
    const snapshot: ReopenPlanSnapshot = {
      groups: [{
        id: 'group-1',
        viewColumn: 2,
        isActive: false,
        activeTabId: 'source',
        tabs: [
          terminalTab('term-1', 0, { unwired: true }),
          {
            id: 'source',
            index: 1,
            isActive: true,
            isPinned: false,
            isDeckTerminal: false,
            isUnwired: false,
            canReveal: true,
            uri: '/repo/src/app.ts',
          },
        ],
      }],
    };

    expect(planReopenUnwiredTerminalTabs(snapshot)).toContainEqual({
      kind: 'reveal',
      tabId: 'source',
      uri: '/repo/src/app.ts',
      viewColumn: 2,
      viewType: undefined,
      reason: 'restore-active',
    });
  });
});

function terminalTab(
  id: string,
  index: number,
  options: { active?: boolean; unwired?: boolean; pinned?: boolean } = {},
) {
  return {
    id,
    index,
    isActive: options.active ?? false,
    isPinned: options.pinned ?? false,
    isDeckTerminal: true,
    isUnwired: options.unwired ?? false,
    canReveal: true,
    uri: `/repo/${id}`,
    viewType: 'deck.terminal',
  };
}
