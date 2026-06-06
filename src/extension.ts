import * as vscode from 'vscode';
import { ProjectTreeProvider } from './tree/projectTree';
import { ActiveWorktreeStore } from './switch/activeWorktreeStore';
import { DetachedOpener } from './switch/detachedOpener';
import { WorktreeSwitcher } from './switch/worktreeSwitcher';
import { AddProjectCommand, VsCodeProjectFolderPicker } from './project/addProjectCommand';
import { ProjectRemovalCommand } from './project/projectRemovalCommand';
import { ProjectCommonDirCache } from './project/projectCommonDirCache';
import { ProjectRegistryStore } from './project/projectRegistryStore';
import { projectsMigration } from './project/projectsMigration';
import { AddWorktreeCommand } from './worktree/addWorktreeCommand';
import { BranchDeletionPreferenceStore } from './worktree/branchDeletionPreferenceStore';
import { WorktreeListCacheStore } from './worktree/worktreeListCacheStore';
import { WorktreeRemovalCommand } from './worktree/worktreeRemovalCommand';
import { WorktreeRootStore } from './worktree/worktreeRootStore';
import { DeckTreeDragAndDropController } from './tree/deckTreeDragAndDropController';
import { WorktreeOrderStore } from './worktree/worktreeOrderStore';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const projectRegistry = new ProjectRegistryStore(context.globalState);
  await migrateProjects(projectRegistry);

  const activeWorktrees = new ActiveWorktreeStore(context.globalState);
  const worktreeRoots = new WorktreeRootStore(context.globalState);
  const worktreeOrders = new WorktreeOrderStore(context.globalState);
  const worktreeListCache = new WorktreeListCacheStore(context.globalState);
  const projectCommonDirCache = new ProjectCommonDirCache(context.globalState);
  const branchDeletionPreferences = new BranchDeletionPreferenceStore(context.globalState);
  const switcher = new WorktreeSwitcher(activeWorktrees);
  const detachedOpener = new DetachedOpener();
  const tree = new ProjectTreeProvider(
    projectRegistry,
    activeWorktrees,
    worktreeOrders,
    worktreeListCache,
    projectCommonDirCache,
  );
  const addWorktree = new AddWorktreeCommand(
    switcher,
    detachedOpener,
    () => tree.refresh(),
    worktreeRoots,
    worktreeListCache,
    projectCommonDirCache,
  );
  const dragAndDropController = new DeckTreeDragAndDropController(
    () => tree.refresh(),
    projectRegistry,
    worktreeOrders,
  );
  const removeWorktree = new WorktreeRemovalCommand(
    activeWorktrees,
    () => tree.refresh(),
    branchDeletionPreferences,
    worktreeListCache,
    projectCommonDirCache,
  );
  const removeProject = new ProjectRemovalCommand(
    projectRegistry,
    activeWorktrees,
    worktreeRoots,
    worktreeOrders,
    () => tree.refresh(),
  );

  const treeView = vscode.window.createTreeView('deck.projects', {
    treeDataProvider: tree,
    dragAndDropController,
    canSelectMany: false,
  });
  const addProject = new AddProjectCommand(
    new VsCodeProjectFolderPicker(),
    projectRegistry,
    activeWorktrees,
    switcher,
    detachedOpener,
    () => tree.refresh(),
    async (projectPath) => {
      const roots = tree.getChildren();
      if (!Array.isArray(roots)) return;
      const project = roots.find((node) => node.projectPath === projectPath);
      if (project) await treeView.reveal(project, { expand: true, select: true });
    },
    projectCommonDirCache,
  );

  context.subscriptions.push(
    treeView,
    vscode.commands.registerCommand('deck.refresh', () => {
      tree.refresh();
    }),
    vscode.commands.registerCommand('deck.addProject', () => addProject.run()),
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
}

export function deactivate(): void {}

async function migrateProjects(projectRegistry: ProjectRegistryStore): Promise<void> {
  const cfg = vscode.workspace.getConfiguration('deck');
  const settingsProjects = cfg.get<string[]>('projects', []);
  const migration = projectsMigration(settingsProjects, projectRegistry.list());

  await projectRegistry.replace(migration.merged);
  if (migration.clearSettings) {
    await cfg.update('projects', undefined, vscode.ConfigurationTarget.Global);
  }
}
