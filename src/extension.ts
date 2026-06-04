import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/projectTree';
import { ActiveWorktreeStore } from './switch/activeWorktreeStore';
import { WorktreeSwitcher } from './switch/worktreeSwitcher';
import { AddWorktreeCommand } from './worktree/addWorktreeCommand';
import { WorktreeRootStore } from './worktree/worktreeRootStore';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const activeWorktrees = new ActiveWorktreeStore(context.globalState);
  const worktreeRoots = new WorktreeRootStore(context.globalState);
  const switcher = new WorktreeSwitcher(activeWorktrees);
  const addWorktree = new AddWorktreeCommand(switcher, worktreeRoots);
  const tree = new ProjectTreeProvider(activeWorktrees);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('deck.projects', tree),
    vscode.commands.registerCommand('deck.refresh', () => {
      tree.refresh();
    }),
    vscode.commands.registerCommand('deck.addProject', () => tree.addProject()),
    vscode.commands.registerCommand('deck.addWorktree', (node) => addWorktree.run(node)),
    vscode.commands.registerCommand('deck.switchWorktree', async (worktreePath: string) => {
      await switcher.switchTo(worktreePath);
      tree.refresh();
    }),
  );

  if (await activeWorktrees.consumeFocusIntent()) {
    await vscode.commands.executeCommand('workbench.view.extension.deck');
  }
}

export function deactivate(): void {}
