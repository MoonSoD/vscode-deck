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
import { CloseTerminalCommand } from './terminal/killTerminalCommand';
import { OpenTerminalCommand } from './terminal/openTerminalCommand';
import { OpenTerminalInNewWindowCommand } from './terminal/openTerminalInNewWindowCommand';
import { PendingTerminalOpenStore } from './terminal/pendingTerminalOpenStore';
import { TerminalCascade } from './terminal/terminalCascade';
import { TerminalEditorProvider, terminalEditorViewType } from './terminal/terminalEditorProvider';
import { TmuxCli, type TmuxSession } from './terminal/tmuxCli';
import { terminalSessionNumber, terminalSessionPrefix } from './terminal/tmuxSafe';
import { tmuxPreflight } from './terminal/tmuxPreflight';
import { SessionUriCodec } from './terminal/sessionUriCodec';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const tmuxAvailability = await tmuxPreflight();
  await vscode.commands.executeCommand('setContext', 'deck.tmuxAvailable', tmuxAvailability.available);
  const tmuxConfigPath = join(context.extensionPath, 'resources', 'deck.conf');
  const tmux = new TmuxCli(tmuxConfigPath);

  const projectRegistry = new ProjectRegistryStore(context.globalState);
  await migrateProjects(projectRegistry);

  const activeWorktrees = new ActiveWorktreeStore(context.globalState);
  const worktreeRoots = new WorktreeRootStore(context.globalState);
  const worktreeOrders = new WorktreeOrderStore(context.globalState);
  const worktreeListCache = new WorktreeListCacheStore(context.globalState);
  const pendingTerminalOpens = new PendingTerminalOpenStore(context.globalState);
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
    tmux,
    tmuxAvailability.available,
  );
  const addTerminal = new AddTerminalCommand(
    tmux,
    () => tree.refresh(),
    { pendingTerminalOpens, switcher },
  );
  const terminalEditorProvider = new TerminalEditorProvider(
    context.extensionUri,
    tmuxConfigPath,
    undefined,
    undefined,
    async (sessionName) => {
      await tmux.killSession(sessionName);
      tree.refresh();
    },
    // %window-renamed from any open terminal's control client → relabel the row
    // live (automatic-rename tracks the foreground command); event-driven, no poll.
    () => tree.refresh(),
    (sessionName) => tmux.windowName(sessionName),
  );
  const openTerminal = new OpenTerminalCommand({
    pendingTerminalOpens,
    switcher,
    terminalPanels: terminalEditorProvider,
  });
  const openTerminalInNewWindow = new OpenTerminalInNewWindowCommand(pendingTerminalOpens);
  const closeTerminal = new CloseTerminalCommand(
    tmux,
    () => tree.refresh(),
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
    vscode.window.registerCustomEditorProvider(terminalEditorViewType, terminalEditorProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
      supportsMultipleEditorsPerDocument: false,
    }),
    terminalEditorProvider,
    vscode.commands.registerCommand('deck.refresh', () => {
      tree.refresh();
    }),
    vscode.commands.registerCommand('deck.addProject', () => addProject.run()),
    vscode.commands.registerCommand('deck.addWorktree', (node) => addWorktree.run(node)),
    vscode.commands.registerCommand('deck.addTerminal', (node) => addTerminal.run(node)),
    vscode.commands.registerCommand('deck.openTerminal', (node) => openTerminal.run(node)),
    vscode.commands.registerCommand('deck.openTerminalInNewWindow', (node) =>
      openTerminalInNewWindow.run(node),
    ),
    vscode.commands.registerCommand('deck.killTerminal', (node) => closeTerminal.run(node)),
    vscode.commands.registerCommand('deck.terminal.find', () => terminalEditorProvider.showFind()),
    vscode.commands.registerCommand('deck.removeProject', (node) => removeProject.run(node)),
    vscode.commands.registerCommand('deck.removeWorktree', (node) => removeWorktree.run(node)),
    vscode.commands.registerCommand('deck.openWorktreeInNewWindow', (node: { worktree: { path: string } }) =>
      detachedOpener.open(node.worktree.path),
    ),
    vscode.commands.registerCommand('deck.switchWorktree', async (worktreePath: string) => {
      await switcher.switchTo(worktreePath);
      tree.refresh();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => tree.refresh()),
    treeView.onDidChangeVisibility((event) => {
      if (event.visible) tree.refresh();
    }),
  );
  if (tmuxAvailability.available) {
    await openPendingTerminalForCurrentWorktree(pendingTerminalOpens, tmux);
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

interface TerminalSessionLister {
  listSessions(prefix?: string): Promise<TmuxSession[]>;
}

export async function openPendingTerminalForCurrentWorktree(
  pendingTerminalOpens: PendingTerminalOpenConsumer,
  tmux: TerminalSessionLister,
): Promise<void> {
  const worktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!worktreePath) return;

  const sessionName = await pendingTerminalOpens.consume(worktreePath);
  if (!sessionName) return;

  const terminals = await tmux.listSessions(terminalSessionPrefix(worktreePath));
  const terminal = terminals.find((candidate) => candidate.sessionName === sessionName);
  if (!terminal) return;
  const term = terminalSessionNumber(worktreePath, sessionName);
  if (term === 0) return;

  // VS Code natively restores this worktree's terminal tabs in their original
  // groups on switch-back. If the clicked terminal is already a restored tab,
  // reveal it in place — passing ViewColumn.Active would *move* it to the
  // last-focused group. Only a terminal with no tab (session alive, tab closed)
  // opens fresh in the active column.
  const existingColumn = findTerminalTabColumn(sessionName);
  await vscode.commands.executeCommand(
    'vscode.openWith',
    new SessionUriCodec().encode({ worktreePath, term }),
    terminalEditorViewType,
    { viewColumn: existingColumn ?? vscode.ViewColumn.Active },
  );
}

// Scans open tabs (not the provider's panel map, which may not be populated yet
// during post-switch restoration) for a Deck terminal tab matching sessionName.
function findTerminalTabColumn(sessionName: string): vscode.ViewColumn | undefined {
  const codec = new SessionUriCodec();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      const input = tab.input as { viewType?: unknown; uri?: vscode.Uri } | undefined;
      if (input?.viewType !== terminalEditorViewType || !input.uri) continue;
      try {
        if (codec.decode(input.uri).sessionName === sessionName) return group.viewColumn;
      } catch {
        // Not a decodable Deck terminal URI; skip.
      }
    }
  }
  return undefined;
}
