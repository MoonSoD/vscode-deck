import { join } from 'node:path';
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
import { AddTerminalCommand } from './terminal/addTerminalCommand';
import { KillTerminalCommand } from './terminal/killTerminalCommand';
import { OpenTerminalCommand } from './terminal/openTerminalCommand';
import { PendingTerminalOpenStore } from './terminal/pendingTerminalOpenStore';
import { TerminalCascade } from './terminal/terminalCascade';
import { TerminalSessionRegistry } from './terminal/terminalSessionRegistry';
import {
  TerminalSessionListCacheStore,
  toCachedTerminalSessions,
} from './terminal/terminalSessionListCacheStore';
import { TmuxCli, TmuxSession } from './terminal/tmuxCli';
import { terminalSessionPrefix, terminalWorktreePrefix } from './terminal/tmuxSafe';
import { tmuxPreflight } from './terminal/tmuxPreflight';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const tmux = new TmuxCli(join(context.extensionPath, 'resources', 'deck.conf'));
  const tmuxAvailability = await tmuxPreflight();
  await vscode.commands.executeCommand('setContext', 'deck.tmuxAvailable', tmuxAvailability.available);

  const projectRegistry = new ProjectRegistryStore(context.globalState);
  await migrateProjects(projectRegistry);

  const activeWorktrees = new ActiveWorktreeStore(context.globalState);
  const worktreeRoots = new WorktreeRootStore(context.globalState);
  const worktreeOrders = new WorktreeOrderStore(context.globalState);
  const worktreeListCache = new WorktreeListCacheStore(context.globalState);
  const terminalSessionListCache = new TerminalSessionListCacheStore(context.globalState);
  const pendingTerminalOpens = new PendingTerminalOpenStore(context.globalState);
  const projectCommonDirCache = new ProjectCommonDirCache(context.globalState);
  const branchDeletionPreferences = new BranchDeletionPreferenceStore(context.globalState);
  const switcher = new WorktreeSwitcher(activeWorktrees);
  const detachedOpener = new DetachedOpener();
  const terminalRegistry = new TerminalSessionRegistry(vscode.window.onDidCloseTerminal);
  const tree = new ProjectTreeProvider(
    projectRegistry,
    activeWorktrees,
    worktreeOrders,
    worktreeListCache,
    projectCommonDirCache,
    tmux,
    tmuxAvailability.available,
    terminalSessionListCache,
    terminalRegistry,
  );
  const addTerminal = new AddTerminalCommand(
    tmux,
    terminalRegistry,
    () => tree.refresh(),
    terminalSessionListCache,
  );
  const openTerminal = new OpenTerminalCommand(tmux, terminalRegistry, {
    pendingTerminalOpens,
    switcher,
  });
  const killTerminal = new KillTerminalCommand(
    tmux,
    () => tree.refresh(),
    terminalSessionListCache,
  );
  const terminalCascade = new TerminalCascade(tmux);
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
    terminalCascade,
  );
  const removeProject = new ProjectRemovalCommand(
    projectRegistry,
    activeWorktrees,
    worktreeRoots,
    worktreeOrders,
    () => tree.refresh(),
    terminalCascade,
    worktreeListCache,
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
      const project = roots.find((node) => 'projectPath' in node && node.projectPath === projectPath);
      if (!project) return;
      try {
        await treeView.reveal(project, { expand: true, select: true });
      } catch (error) {
        // Reveal can fail if VS Code's internal element map is out of sync
        // with the freshly-constructed ProjectNode; the project is still in
        // the tree, just not scrolled into view.
        console.warn('Deck: TreeView.reveal failed', error);
      }
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
    vscode.commands.registerCommand('deck.addTerminal', (node) => addTerminal.run(node)),
    vscode.commands.registerCommand('deck.openTerminal', (node) => openTerminal.run(node)),
    vscode.commands.registerCommand('deck.killTerminal', (node) => killTerminal.run(node)),
    vscode.commands.registerCommand('deck.removeProject', (node) => removeProject.run(node)),
    vscode.commands.registerCommand('deck.removeWorktree', (node) => removeWorktree.run(node)),
    vscode.commands.registerCommand('deck.openWorktreeInNewWindow', (node: { worktree: { path: string } }) =>
      detachedOpener.open(node.worktree.path),
    ),
    vscode.commands.registerCommand('deck.switchWorktree', async (worktreePath: string) => {
      await switcher.switchTo(worktreePath);
      tree.refresh();
    }),
    terminalRegistry,
    vscode.workspace.onDidChangeWorkspaceFolders(() => tree.refresh()),
    treeView.onDidChangeVisibility((event) => {
      if (event.visible) tree.refresh();
    }),
    vscode.window.onDidChangeActiveTerminal((active) => {
      if (!active) return;
      tree.handleActiveTerminalChange(active);
    }),
  );
  if (tmuxAvailability.available) {
    await openPendingTerminalForCurrentWorktree(pendingTerminalOpens, terminalSessionListCache, tmux);
  }
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

interface PendingTerminalOpenConsumer {
  consume(worktreePath: string): Promise<string | undefined>;
}

interface TerminalSessionCacheWriter {
  set(prefix: string, terminals: ReturnType<typeof toCachedTerminalSessions>): Promise<void>;
}

interface TerminalSessionLister {
  listSessions(prefix?: string): Promise<TmuxSession[]>;
}

export async function openPendingTerminalForCurrentWorktree(
  pendingTerminalOpens: PendingTerminalOpenConsumer,
  terminalSessionListCache: TerminalSessionCacheWriter,
  tmux: TerminalSessionLister,
): Promise<void> {
  const worktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!worktreePath) return;

  const sessionName = await pendingTerminalOpens.consume(worktreePath);
  if (!sessionName) return;

  const terminals = toCachedTerminalSessions(
    worktreePath,
    await tmux.listSessions(terminalSessionPrefix(worktreePath)),
  );
  await terminalSessionListCache.set(terminalWorktreePrefix(worktreePath), terminals);
  const terminal = terminals.find((candidate) => candidate.sessionName === sessionName);
  if (!terminal) return;

  await vscode.commands.executeCommand('deck.openTerminal', {
    terminal,
    n: terminal.n,
    worktreePath,
  });
}
