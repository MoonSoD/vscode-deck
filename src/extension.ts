import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/projectTree';
import { ActiveWorktreeStore } from './switch/activeWorktreeStore';
import { MountReconciler } from './switch/mountReconciliation';
import { WorktreeSwitcher } from './switch/worktreeSwitcher';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const activeWorktrees = new ActiveWorktreeStore(context.globalState);
  const switcher = new WorktreeSwitcher(activeWorktrees);
  const tree = new ProjectTreeProvider(activeWorktrees);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('deck.projects', tree),
    vscode.commands.registerCommand('deck.refresh', () => tree.refresh()),
    vscode.commands.registerCommand('deck.addProject', () => tree.addProject()),
    vscode.commands.registerCommand('deck.switchWorktree', async (worktreePath: string) => {
      await switcher.switchTo(worktreePath);
      tree.refresh();
    }),
  );

  await new MountReconciler(activeWorktrees).reconcile();
}

export function deactivate(): void {}
