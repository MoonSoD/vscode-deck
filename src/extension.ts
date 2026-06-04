import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/projectTree';
import { ActiveWorktreeStore } from './switch/activeWorktreeStore';
import { WorktreeSwitcher } from './switch/worktreeSwitcher';
import { ProjectRemovalCommand } from './project/projectRemovalCommand';
import { AddWorktreeCommand } from './worktree/addWorktreeCommand';
import { BranchDeletionPreferenceStore } from './worktree/branchDeletionPreferenceStore';
import { WorktreeRemovalCommand } from './worktree/worktreeRemovalCommand';
import { WorktreeRootStore } from './worktree/worktreeRootStore';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const activeWorktrees = new ActiveWorktreeStore(context.globalState);
  const worktreeRoots = new WorktreeRootStore(context.globalState);
  const branchDeletionPreferences = new BranchDeletionPreferenceStore(context.globalState);
  const switcher = new WorktreeSwitcher(activeWorktrees);
  const addWorktree = new AddWorktreeCommand(switcher, worktreeRoots);
  const tree = new ProjectTreeProvider(activeWorktrees);
  const removeWorktree = new WorktreeRemovalCommand(
    activeWorktrees,
    () => tree.refresh(),
    branchDeletionPreferences,
  );
  const removeProject = new ProjectRemovalCommand(
    activeWorktrees,
    worktreeRoots,
    () => tree.refresh(),
  );

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('deck.projects', tree),
    vscode.commands.registerCommand('deck.refresh', () => {
      tree.refresh();
    }),
    vscode.commands.registerCommand('deck.addProject', () => tree.addProject()),
    vscode.commands.registerCommand('deck.addWorktree', (node) => addWorktree.run(node)),
    vscode.commands.registerCommand('deck.removeProject', (node) => removeProject.run(node)),
    vscode.commands.registerCommand('deck.removeWorktree', (node) => removeWorktree.run(node)),
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
