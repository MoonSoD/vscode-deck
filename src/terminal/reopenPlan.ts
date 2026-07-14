export interface ReopenPlanTab {
  readonly id: string;
  readonly index: number;
  readonly isPinned: boolean;
  readonly isDeckTerminal: boolean;
  readonly isUnwired: boolean;
  readonly canReveal: boolean;
  readonly uri?: unknown;
  readonly viewType?: string;
}

export interface ReopenPlanGroup {
  readonly viewColumn: number;
  readonly isActive: boolean;
  readonly activeTabId?: string;
  readonly tabs: readonly ReopenPlanTab[];
}

export interface ReopenPlanSnapshot {
  readonly groups: readonly ReopenPlanGroup[];
}

export type ReopenPlanOperation =
  | { readonly kind: 'close'; readonly tabId: string }
  | { readonly kind: 'open'; readonly tabId: string; readonly uri: unknown; readonly viewColumn: number }
  | { readonly kind: 'move'; readonly tabId: string; readonly index: number }
  | { readonly kind: 'pin'; readonly tabId: string }
  | {
    readonly kind: 'reveal';
    readonly tabId: string;
    readonly uri: unknown;
    readonly viewColumn: number;
    readonly viewType?: string;
    readonly reason: 'restore-active' | 'restore-focus';
  };

export function planReopenUnwiredTerminalTabs(
  snapshot: ReopenPlanSnapshot,
): ReopenPlanOperation[] {
  const operations: ReopenPlanOperation[] = [];
  let focusedGroupActiveTab: ReopenPlanTab | undefined;
  let focusedGroupViewColumn: number | undefined;

  for (const group of snapshot.groups) {
    const activeTab = group.tabs.find((tab) => tab.id === group.activeTabId);
    const targets = group.tabs.filter((tab) => tab.isDeckTerminal && tab.isUnwired && tab.uri !== undefined);
    if (targets.length === 0) {
      if (group.isActive && activeTab) {
        focusedGroupActiveTab = activeTab;
        focusedGroupViewColumn = group.viewColumn;
      }
      continue;
    }

    if (activeTab && !canRestoreActiveTab(activeTab, targets)) continue;

    const activeTarget = activeTab && targets.find((tab) => tab.id === activeTab.id);
    const hiddenTargets = targets
      .filter((tab) => tab.id !== activeTarget?.id)
      .sort((left, right) => left.index - right.index);
    const orderedTargets = activeTarget ? [...hiddenTargets, activeTarget] : hiddenTargets;

    for (const tab of orderedTargets) {
      operations.push(
        { kind: 'close', tabId: tab.id },
        { kind: 'open', tabId: tab.id, uri: tab.uri, viewColumn: group.viewColumn },
        { kind: 'move', tabId: tab.id, index: tab.index },
      );
      if (tab.isPinned) operations.push({ kind: 'pin', tabId: tab.id });
    }

    if (group.isActive) {
      focusedGroupActiveTab = activeTab;
      focusedGroupViewColumn = group.viewColumn;
    } else if (activeTab && activeTab.id !== activeTarget?.id && activeTab.uri !== undefined) {
      operations.push({
        kind: 'reveal',
        tabId: activeTab.id,
        uri: activeTab.uri,
        viewColumn: group.viewColumn,
        viewType: activeTab.viewType,
        reason: 'restore-active',
      });
    }
  }

  if (
    operations.length > 0 &&
    focusedGroupActiveTab &&
    focusedGroupViewColumn !== undefined &&
    focusedGroupActiveTab.uri !== undefined &&
    canRestoreFocusedTab(focusedGroupActiveTab, operations)
  ) {
    operations.push({
      kind: 'reveal',
      tabId: focusedGroupActiveTab.id,
      uri: focusedGroupActiveTab.uri,
      viewColumn: focusedGroupViewColumn,
      viewType: focusedGroupActiveTab.viewType,
      reason: 'restore-focus',
    });
  }

  return operations;
}

function canRestoreActiveTab(
  activeTab: ReopenPlanTab,
  targets: readonly ReopenPlanTab[],
): boolean {
  return targets.some((tab) => tab.id === activeTab.id) || activeTab.canReveal;
}

function canRestoreFocusedTab(
  activeTab: ReopenPlanTab,
  operations: readonly ReopenPlanOperation[],
): boolean {
  return activeTab.canReveal || operations.some((operation) =>
    operation.kind === 'open' && operation.tabId === activeTab.id
  );
}
