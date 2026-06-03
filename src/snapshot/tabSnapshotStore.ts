import * as vscode from 'vscode';

export interface TabSnapshot {
  uri: string;
  viewColumn: number;
  pinned: boolean;
  active: boolean;
}

export class TabSnapshotStore {
  constructor(private readonly memento: vscode.Memento) {}

  private key(worktreePath: string): string {
    return `worktree:${worktreePath}:tabs`;
  }

  capture(): TabSnapshot[] {
    const snapshot: TabSnapshot[] = [];
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const input = tab.input;
        if (input instanceof vscode.TabInputText) {
          snapshot.push({
            uri: input.uri.toString(),
            viewColumn: group.viewColumn,
            pinned: tab.isPinned,
            active: tab.isActive,
          });
        }
      }
    }
    return snapshot;
  }

  async save(worktreePath: string, snapshot: TabSnapshot[]): Promise<void> {
    await this.memento.update(this.key(worktreePath), snapshot);
  }

  load(worktreePath: string): TabSnapshot[] {
    return this.memento.get<TabSnapshot[]>(this.key(worktreePath), []);
  }
}
