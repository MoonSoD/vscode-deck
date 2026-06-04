import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/projectTree';
import { ActiveWorktreeStore } from './switch/activeWorktreeStore';
import { DetachedOpener } from './switch/detachedOpener';
import { WorktreeSwitcher } from './switch/worktreeSwitcher';
import { ProjectRemovalCommand } from './project/projectRemovalCommand';
import { AddWorktreeCommand } from './worktree/addWorktreeCommand';
import { BranchDeletionPreferenceStore } from './worktree/branchDeletionPreferenceStore';
import { WorktreeRemovalCommand } from './worktree/worktreeRemovalCommand';
import { WorktreeRootStore } from './worktree/worktreeRootStore';
import { DeckTreeDragAndDropController } from './tree/deckTreeDragAndDropController';
import { WorktreeOrderStore } from './worktree/worktreeOrderStore';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const activeWorktrees = new ActiveWorktreeStore(context.globalState);
  const worktreeRoots = new WorktreeRootStore(context.globalState);
  const worktreeOrders = new WorktreeOrderStore(context.globalState);
  const branchDeletionPreferences = new BranchDeletionPreferenceStore(context.globalState);
  const switcher = new WorktreeSwitcher(activeWorktrees);
  const detachedOpener = new DetachedOpener(activeWorktrees);
  const addWorktree = new AddWorktreeCommand(switcher, worktreeRoots);
  const tree = new ProjectTreeProvider(activeWorktrees, worktreeOrders);
  const dragAndDropController = new DeckTreeDragAndDropController(
    () => tree.refresh(),
    worktreeOrders,
  );
  const removeWorktree = new WorktreeRemovalCommand(
    activeWorktrees,
    () => tree.refresh(),
    branchDeletionPreferences,
  );
  const removeProject = new ProjectRemovalCommand(
    activeWorktrees,
    worktreeRoots,
    worktreeOrders,
    () => tree.refresh(),
  );

  context.subscriptions.push(
    vscode.window.createTreeView('deck.projects', {
      treeDataProvider: tree,
      dragAndDropController,
      canSelectMany: false,
    }),
    vscode.commands.registerCommand('deck.refresh', () => {
      tree.refresh();
    }),
    vscode.commands.registerCommand('deck.addProject', () => tree.addProject()),
    vscode.commands.registerCommand('deck.addWorktree', (node) => addWorktree.run(node)),
    vscode.commands.registerCommand('deck.removeProject', (node) => removeProject.run(node)),
    vscode.commands.registerCommand('deck.removeWorktree', (node) => removeWorktree.run(node)),
    vscode.commands.registerCommand('deck.openWorktreeInNewWindow', (node: { worktree: { path: string } }) =>
      detachedOpener.open(node.worktree.path),
    ),
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
