import * as vscode from 'vscode';
import { TabSnapshotStore } from '../snapshot/tabSnapshotStore';

const ACTIVE_KEY = 'deck.activeWorktree';

export class WorktreeSwitcher {
  constructor(private readonly snapshots: TabSnapshotStore) {}

  async switchTo(targetPath: string): Promise<void> {
    const previous = vscode.workspace.getConfiguration().get<string>(ACTIVE_KEY);
    if (previous === targetPath) return;

    if (vscode.workspace.getConfiguration('deck').get<boolean>('autoSaveOnSwitch', true)) {
      await vscode.workspace.saveAll(false);
    }

    if (previous) {
      const captured = this.snapshots.capture();
      await this.snapshots.save(previous, captured);
    }

    const allTabs = vscode.window.tabGroups.all.flatMap((g) => g.tabs);
    if (allTabs.length > 0) {
      await vscode.window.tabGroups.close(allTabs);
    }

    const target = this.snapshots.load(targetPath);
    for (const t of target) {
      try {
        const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(t.uri));
        await vscode.window.showTextDocument(doc, {
          viewColumn: t.viewColumn,
          preview: false,
          preserveFocus: !t.active,
        });
      } catch {
        // Tab refers to a file that no longer exists — skip.
      }
    }

    await vscode.workspace
      .getConfiguration()
      .update(ACTIVE_KEY, targetPath, vscode.ConfigurationTarget.Global);
  }
}
