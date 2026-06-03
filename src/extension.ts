import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/projectTree';
import { WorktreeSwitcher } from './switch/worktreeSwitcher';
import { TabSnapshotStore } from './snapshot/tabSnapshotStore';

export function activate(context: vscode.ExtensionContext): void {
  const snapshots = new TabSnapshotStore(context.globalState);
  const switcher = new WorktreeSwitcher(snapshots);
  const tree = new ProjectTreeProvider();

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('deck.projects', tree),
    vscode.commands.registerCommand('deck.refresh', () => tree.refresh()),
    vscode.commands.registerCommand('deck.addProject', () => tree.addProject()),
    vscode.commands.registerCommand('deck.switchWorktree', (worktreePath: string) =>
      switcher.switchTo(worktreePath),
    ),
  );
}

export function deactivate(): void {}
