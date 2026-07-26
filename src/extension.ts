import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { RepositoryTreeProvider, type RepositoryTreeNode } from './tree/repositoryTree';
import { revealWithRetry } from './tree/revealWithRetry';
import { ActiveWorktreeStore } from './switch/activeWorktreeStore';
import { DetachedOpener } from './switch/detachedOpener';
import { WorktreeSwitcher } from './switch/worktreeSwitcher';
import { AddRepositoryCommand, VsCodeRepositoryFolderPicker } from './repository/addRepositoryCommand';
import { RepositoryRemovalCommand } from './repository/repositoryRemovalCommand';
import { ExternalGitWatch } from './repository/externalGitWatch';
import { RepositoryCommonDirCache, resolveCommonDirSafe } from './repository/repositoryCommonDirCache';
import { RepositoryRegistryStore } from './repository/repositoryRegistryStore';
import { watchGitCommonDir } from './repository/vscodeExternalGitWatch';
import { AddWorktreeCommand } from './worktree/addWorktreeCommand';
import { BranchDeletionPreferenceStore } from './worktree/branchDeletionPreferenceStore';
import { WorktreeListCacheStore } from './worktree/worktreeListCacheStore';
import { WorktreeRemovalCommand } from './worktree/worktreeRemovalCommand';
import { WorktreeRootStore } from './worktree/worktreeRootStore';
import { DeckTreeDragAndDropController } from './tree/deckTreeDragAndDropController';
import { WorktreeOrderStore } from './worktree/worktreeOrderStore';
import { AddTerminalCommand } from './terminal/addTerminalCommand';
import { RunLauncherCommand } from './terminal/runLauncherCommand';
import { WorktreeCreateLauncherRunner } from './terminal/worktreeCreateLauncherRunner';
import { TerminalRemovalCommand } from './terminal/killTerminalCommand';
import { OpenTerminalCommand } from './terminal/openTerminalCommand';
import { OpenTerminalInNewWindowCommand } from './terminal/openTerminalInNewWindowCommand';
import { PendingTerminalOpenStore } from './terminal/pendingTerminalOpenStore';
import { TerminalCascade } from './terminal/terminalCascade';
import { TerminalOrderStore } from './terminal/terminalOrderStore';
import {
  TerminalEditorProvider,
  terminalEditorViewType,
} from './terminal/terminalEditorProvider';
import { DisconnectedTabWatch } from './terminal/disconnectedTabWatch';
import { TmuxCli, type TmuxSession } from './terminal/tmuxCli';
import { terminalSessionNumber, terminalSessionPrefix } from './terminal/tmuxSafe';
import { tmuxPreflight } from './terminal/tmuxPreflight';
import { SessionUriCodec } from './terminal/sessionUriCodec';
import { renderDeckConf } from './terminal/deckConf';
import { resolveDeckTmuxOptions, type DeckTmuxOptions } from './terminal/deckTmuxOptions';
import {
  TERMINAL_SNAPSHOT_ANCHOR_SESSION,
  TerminalSnapshotRuntime,
} from './terminal/terminalSnapshotRuntime';
import {
  formatTerminalSnapshotRestoreProgress,
  terminalSnapshotLastSaveTime,
  type TerminalSnapshotRestoreFeedback,
} from './terminal/terminalSnapshotRestoreFeedback';
import { createRestoreCoordinator } from './terminal/restoreGate';
import { deckSocketPath, WedgeRecovery } from './terminal/deckSocketRecovery';
import { SNAPSHOT_LOCK_FILENAME, RecoveryLock } from './terminal/recoveryLock';
import { AgentSidecarStore } from './agent/agentSidecarStore';
import { AgentExitSweep } from './agent/agentExitSweep';
import { PsProcessProbe } from './agent/agentLivenessProbe';
import { AgentPaneProbe } from './agent/agentPaneProbe';
import { DeckDecorationProvider } from './tree/deckDecorationProvider';
import { AgentStatusNotifier } from './agent/agentStatusNotifier';
import { AgentStatusStore } from './agent/agentStatusStore';
import { createChatSessionStore } from './chat/chatSessionStore';
import { openChatSession, type OpenChatSessionTarget } from './chat/openChatSessionCommand';
import { chatWindowTitleMatches, collectOpenChatWindowTitles } from './chat/openChatWindows';
import { resolvePreviews } from './browser/resolvePreviews';
import { PreviewStore } from './browser/previewStore';
import { BrowserStateStore } from './browser/browserStateStore';
import { ChromeLauncher } from './browser/chromeLauncher';
import { CdpClient } from './browser/cdpClient';
import { DeckBrowserController } from './browser/deckBrowserController';
import { BrowserPoll } from './browser/browserPoll';
import { findFreePort } from './browser/freePort';
import { isPortListening } from './browser/portProbe';
import { RunPreviewCommand } from './browser/runPreviewCommand';
import { previewEnv, previewUrl } from './browser/previewPort';
import type { PreviewDefinition } from './browser/previewDefinition';
import { PendingChatOpenStore } from './chat/pendingChatOpenStore';
import { createOpenChatWindowStore } from './chat/openChatWindowStore';
import type { ChatSession } from './chat/scanChatSessions';
import { TerminalPoll } from './terminal/terminalPoll';
import type { AgentName } from './agent/agentTypes';
import { AgentDetection } from './agent/agentDetection';
import { AgentSetupPrompt, type AgentConfigChange } from './agent/agentSetupPrompt';
import { HookInstaller, type HookReconcileResult } from './agent/hookInstaller';
import { rewriteTerminalSnapshotAgentSessions } from './agent/terminalSnapshotAgentSessions';
import { ResumeTemplate } from './agent/resumeTemplate';
import { SnapshotRewriter } from './agent/snapshotRewriter';

let terminalSnapshotRuntime: TerminalSnapshotRuntime | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const tmuxAvailability = await tmuxPreflight();
  await vscode.commands.executeCommand('setContext', 'deck.tmuxAvailable', tmuxAvailability.available);
  const initialTmuxOptions = deckTmuxOptionsFromSettings();
  showDeckTmuxOptionWarnings(initialTmuxOptions);
  const tmuxConfigPath = await writeDeckConf(context, initialTmuxOptions);
  const tmux = new TmuxCli(tmuxConfigPath);
  await applyDeckTmuxOptionsIfServerRunning(tmux, initialTmuxOptions, tmuxAvailability.available);
  const deckDir = deckDataDir();
  let treeView: vscode.TreeView<RepositoryTreeNode> | undefined;
  const agentSidecars = new AgentSidecarStore(join(deckDir, 'hooks'));
  const agentStatuses = new AgentStatusStore(join(deckDir, 'status'), 100);
  const agentStatusWatch = await agentStatuses.start();
  const chatSessions = createChatSessionStore();
  const chatSessionWatch = await chatSessions.start();
  // ChatSessionStatus mirrors AgentStatus but is keyed by the Claude agent
  // session id (the hook writes it here when a claude-vscode window fires with no
  // DECK_SESSION), so the same status machinery drives chat rows' dots and toasts.
  const chatStatuses = new AgentStatusStore(join(deckDir, 'chat-status'), 100);
  const chatStatusWatch = await chatStatuses.start();
  // Each VS Code window sees only its own tabs, so it publishes the Claude chat
  // titles it has open here and reads the union across all windows — that is how
  // a session open in another window is recognised as open (see ADR-0053). Keyed
  // by a per-window id (env.sessionId is per window; the ext-host pid hardens it).
  const openChatWindows = createOpenChatWindowStore({
    dir: join(deckDir, 'open-chat'),
    windowKey: `${vscode.env.sessionId}-${process.pid}`,
  });
  const openChatWindowWatch = await openChatWindows.start();
  const resolveAgentName = async (sessionName: string): Promise<AgentName | undefined> => {
    const status = agentStatuses.get(sessionName);
    if (status !== undefined) return status.agent ?? 'claude';

    try {
      return (await agentSidecars.read(sessionName))?.agent;
    } catch {
      return undefined;
    }
  };
  const tmuxSessionsWithAgentNames = {
    listSessions: async (prefix?: string): Promise<TmuxSession[]> => {
      const sessions = await tmux.listSessions(prefix);
      return Promise.all(sessions.map(async (session) => {
        const agentName = session.agentName ?? await resolveAgentName(session.sessionName);
        if (agentName === undefined) return session;
        return { ...session, agentName };
      }));
    },
  };
  let agentExitSweep: AgentExitSweep | undefined;
  let terminalPoll: TerminalPoll | undefined;
  let agentExitSweepReady = false;
  const wakeAgentExitSweep = () => {
    if (!agentExitSweepReady) return;
    agentExitSweep?.wake();
  };
  const startAgentExitSweep = () => {
    agentExitSweepReady = true;
    agentExitSweep?.wake();
  };
  const activeTerminalReadWatch = agentStatuses.onDidChange(() => {
    void markActiveTerminalRead(agentStatuses);
  });
  const activeChatReadWatch = chatStatuses.onDidChange(() => {
    void markActiveChatSessionRead(chatStatuses, chatSessions);
  });
  const agentExitSweepWakeWatch = agentStatuses.onDidChange(() => {
    wakeAgentExitSweep();
  });
  void markActiveTerminalRead(agentStatuses);
  void markActiveChatSessionRead(chatStatuses, chatSessions);
  const hookInstaller = new HookInstaller({
    claudeSettingsPath: join(process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude'), 'settings.json'),
    codexHooksPath: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'hooks.json'),
    hookScriptPath: join(deckDir, 'bin', 'deck-claude-hook.sh'),
    codexHookScriptPath: join(deckDir, 'bin', 'deck-codex-hook.sh'),
    sidecarDir: join(deckDir, 'hooks'),
  });
  const agentSetupPrompt = new AgentSetupPrompt({
    detector: new AgentDetection(),
    installer: hookInstaller,
    globalState: context.globalState,
    notifications: vscode.window,
    reviewer: {
      showChanges: showAgentHookConfigChanges,
    },
  });

  terminalSnapshotRuntime = tmuxAvailability.available
    ? new TerminalSnapshotRuntime(
        tmux,
        () => terminalSnapshotSaveScriptPath(context),
        () => terminalSnapshotRestoreScriptPath(context),
        () => deckDir,
        () => rewriteTerminalSnapshotAgentSessions(
          join(deckDir, 'resurrect', 'last'),
          agentSidecars,
          new SnapshotRewriter(resumeTemplateFromSettings()),
        ),
        new WedgeRecovery({
          isServerRunning: () => tmux.isServerRunning(),
          startServer: () => tmux.newAnchorSession(TERMINAL_SNAPSHOT_ANCHOR_SESSION, deckDir),
          socketPath: () => deckSocketPath(),
          socketExists,
          removeSocket: (path) => rm(path, { force: true }),
          recoveryLock: new RecoveryLock({
            deckDir,
            isHealthy: () => tmux.isServerRunning(),
          }),
        }),
        terminalSnapshotRestoreFeedback(deckDir, () => treeView),
        new RecoveryLock({
          deckDir,
          lockFilename: SNAPSHOT_LOCK_FILENAME,
          isHealthy: () => tmux.isServerRunning(),
        }),
      )
    : undefined;

  // A terminal-tab reattach (which issues `new-session -A`) awaits this gate
  // before touching tmux, so it can never resurrect a session blank ahead of
  // restore — on reopen after reboot, or when the DeckSocket dies while VS Code
  // stays open. See restoreGate.ts.
  const snapshotRuntime = terminalSnapshotRuntime;
  const restoreCoordinator = snapshotRuntime
    ? createRestoreCoordinator({
        listSessions: () => tmux.listSessions(),
        restore: () => snapshotRuntime.restoreOnActivation(),
        restoreLock: new RecoveryLock({
          deckDir,
          lockFilename: SNAPSHOT_LOCK_FILENAME,
          isHealthy: () => tmux.isServerRunning(),
        }),
      })
    : undefined;
  const ensureSnapshotRestored = restoreCoordinator
    ? async () => {
        await restoreCoordinator.ensureRestored();
      }
    : () => Promise.resolve();
  const repositoryRegistry = new RepositoryRegistryStore(context.globalState);

  const activeWorktrees = new ActiveWorktreeStore(context.globalState);
  const worktreeRoots = new WorktreeRootStore(context.globalState);
  const worktreeOrders = new WorktreeOrderStore(context.globalState);
  const terminalOrders = new TerminalOrderStore(context.globalState);
  const worktreeListCache = new WorktreeListCacheStore(context.globalState);
  const pendingTerminalOpens = new PendingTerminalOpenStore(context.globalState);
  // File-backed (not globalState) so an already-running window's watcher sees a
  // queued open the moment another window writes it — globalState is cached in
  // memory per window and would never reach a running one.
  const pendingChatOpens = new PendingChatOpenStore(join(deckDir, 'pending-chat'));
  const pendingChatWatch = await pendingChatOpens.start();
  void pendingChatOpens.prune();
  const pendingWorktreeRemovals = new Set<string>();
  const repositoryCommonDirCache = new RepositoryCommonDirCache(context.globalState);
  const branchDeletionPreferences = new BranchDeletionPreferenceStore(context.globalState);
  const switcher = new WorktreeSwitcher(activeWorktrees);
  const detachedOpener = new DetachedOpener();

  // DeckBrowser: per-Worktree isolated Chrome instances shown as PreviewWindow
  // rows. PreviewStore resolves the rows from config; BrowserStateStore persists
  // each Worktree's debug port and profile-seeding under deckDir; BrowserPoll
  // observes which windows are live to drive the open badge.
  const deckConfig = () => vscode.workspace.getConfiguration('deck');
  const resolvePreviewDefs = (worktreePath: string) =>
    resolvePreviews(
      worktreePath,
      deckConfig().get('previews'),
      deckConfig().get('repositoryPreviews'),
      { resolveCommonDir: (repositoryPath) => resolveCommonDirSafe(repositoryCommonDirCache, repositoryPath) },
    );
  const previewStore = new PreviewStore(resolvePreviewDefs);
  const browserState = new BrowserStateStore(join(deckDir, 'browser', 'state.json'));
  const deckBrowser = new DeckBrowserController({
    launcher: new ChromeLauncher(
      deckConfig().get<string>('chromePath') || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    ),
    cdp: new CdpClient(),
    state: browserState,
    deckDir,
    allocatePort: findFreePort,
    profileTemplate: () => deckConfig().get<string>('chromeProfileTemplate'),
    copyDir: (from, to) => cp(from, to, { recursive: true }),
    removeDir: (dir) => rm(dir, { recursive: true, force: true }),
    killPid: (pid) => process.kill(pid),
  });
  // A preview is ON when its dev server is serving its PreviewPort — a focus-gated
  // TCP probe of the previews the tree has resolved so far.
  const browserPoll = new BrowserPoll({
    previewEntries: () => previewStore.entries(),
    isPortListening: (port) => isPortListening(port),
    isFocused: () => vscode.window.state.focused,
    onDidChangeFocus: (listener) =>
      vscode.window.onDidChangeWindowState((state) => listener(state.focused)),
    onError: (error) => console.warn('Deck: browser poll failed', error),
  });
  // The PreviewPort env (e.g. PORT=3042) injected into every Terminal Deck creates
  // for a Worktree, so dev servers bind the port their PreviewWindow points at.
  const resolvePreviewEnv = async (worktreePath: string): Promise<Record<string, string>> =>
    previewEnv(worktreePath, await resolvePreviewDefs(worktreePath));

  const tree = new RepositoryTreeProvider(
    repositoryRegistry,
    activeWorktrees,
    worktreeOrders,
    worktreeListCache,
    repositoryCommonDirCache,
    tmuxSessionsWithAgentNames,
    tmuxAvailability.available,
    pendingWorktreeRemovals,
    agentStatuses,
    terminalOrders,
    ensureSnapshotRestored,
    chatSessions,
    chatStatuses,
    previewStore,
    browserPoll,
  );
  // Applies the show/hide-closed-ChatSessions preference (hidden by default) to
  // both the tree filter and the context key that swaps the title-bar toggle
  // button — so a Settings edit and the button take the same path.
  const applyShowClosedChatSessions = async (): Promise<void> => {
    const show = deckConfig().get<boolean>('showClosedChatSessions', false);
    tree.setShowClosedChatSessions(show);
    await vscode.commands.executeCommand('setContext', 'deck.showClosedChatSessions', show);
  };
  void applyShowClosedChatSessions();
  agentExitSweep = tmuxAvailability.available
    ? new AgentExitSweep({
        sidecars: agentSidecars,
        statuses: agentStatuses,
        teardown: tmux,
        serverStart: tmux,
        paneProbe: new AgentPaneProbe(tmux, new PsProcessProbe()),
        paneCapture: tmux,
        onError: (error) => console.warn('Deck: agent exit sweep failed', error),
      })
    : undefined;
  const externalGitWatch = new ExternalGitWatch(watchGitCommonDir, refreshTree);
  let externalGitSyncVersion = 0;

  function refreshTree(): void {
    tree.refresh();
    terminalPoll?.start();
    browserPoll.start();
    wakeAgentExitSweep();
    syncExternalGitWatches();
  }

  function syncExternalGitWatches(): void {
    const version = ++externalGitSyncVersion;
    void registeredCommonDirs(repositoryRegistry, repositoryCommonDirCache).then((commonDirs) => {
      if (version !== externalGitSyncVersion) return;
      externalGitWatch.sync(commonDirs);
    });
  }

  syncExternalGitWatches();

  const addTerminal = new AddTerminalCommand(
    tmux,
    refreshTree,
    undefined,
    ensureSnapshotRestored,
    resolvePreviewEnv,
  );
  const runLauncher = new RunLauncherCommand(tmux, {
    refresh: refreshTree,
    beforeCreate: ensureSnapshotRestored,
    resolveCommonDir: (repositoryPath) =>
      resolveCommonDirSafe(repositoryCommonDirCache, repositoryPath),
    resolvePreviewEnv,
  });
  const worktreeCreateLaunchers = new WorktreeCreateLauncherRunner(tmux, {
    refresh: refreshTree,
    beforeCreate: ensureSnapshotRestored,
    resolveCommonDir: (repositoryPath) =>
      resolveCommonDirSafe(repositoryCommonDirCache, repositoryPath),
    resolvePreviewEnv,
  });
  const runPreview = new RunPreviewCommand(tmux, {
    resolvePreviews: resolvePreviewDefs,
    resolvePreviewEnv,
    refresh: refreshTree,
    beforeCreate: ensureSnapshotRestored,
  });
  const terminalEditorProvider = new TerminalEditorProvider(
    context.extensionUri,
    tmuxConfigPath,
    undefined,
    undefined,
    refreshTree,
    // %window-renamed from any open terminal's control client → relabel the row
    // live (automatic-rename tracks the foreground command); event-driven, no poll.
    async (sessionName) => {
      const session = await tmux.terminalSession(sessionName);
      if (session) tree.refreshTerminalDisplays([session]);
    },
    (sessionName) => tmux.terminalSession(sessionName),
    ensureSnapshotRestored,
    resolveAgentName,
  );
  const disconnectedTabs = new DisconnectedTabWatch({
    panelFor: (sessionName) => terminalEditorProvider.panelFor(sessionName),
  });
  terminalPoll = tmuxAvailability.available
    ? new TerminalPoll({
        listSessions: () => tmux.listSessions(),
        isFocused: () => vscode.window.state.focused,
        onDidChangeFocus: (listener) =>
          vscode.window.onDidChangeWindowState((state) => listener(state.focused)),
        onError: (error) => console.warn('Deck: terminal poll failed', error),
        resolveAgentName,
      })
    : undefined;
  const terminalPollWatch = terminalPoll?.onChange((changedSessions) => {
    tree.refreshTerminalDisplays(changedSessions);
    terminalEditorProvider.refreshTitles(changedSessions.map((session) => session.sessionName));
  });
  const terminalPollSessionSetWatch = terminalPoll?.onDidChangeSessionSet(refreshTree);
  terminalPoll?.start();
  browserPoll.start();
  const openTerminal = new OpenTerminalCommand({
    terminalPanels: terminalEditorProvider,
  });
  const openTerminalInNewWindow = new OpenTerminalInNewWindowCommand(pendingTerminalOpens);
  const removeAgentStatus = (sessionName: string) => agentStatuses.remove(sessionName);
  const terminalRemoval = new TerminalRemovalCommand(
    tmux,
    refreshTree,
    confirmTerminalRemoval,
    undefined,
    removeAgentStatus,
  );
  const terminalCascade = new TerminalCascade(tmux, undefined, removeAgentStatus);
  const addWorktree = new AddWorktreeCommand(
    switcher,
    detachedOpener,
    refreshTree,
    worktreeRoots,
    worktreeListCache,
    repositoryCommonDirCache,
    worktreeCreateLaunchers,
  );
  const revealRepository = async (repositoryPath: string) => {
    const roots = tree.getChildren();
    if (!Array.isArray(roots)) return;
    const repository = roots.find((node) => 'repositoryPath' in node && node.repositoryPath === repositoryPath);
    if (!repository) return;
    try {
      await treeView?.reveal(repository, { expand: true, select: true });
    } catch (error) {
      // Reveal can fail if VS Code's internal element map is out of sync
      // with the freshly-constructed RepositoryNode; the repository is still in
      // the tree, just not scrolled into view.
      console.warn('Deck: TreeView.reveal failed', error);
    }
  };
  const dragAndDropController = new DeckTreeDragAndDropController(
    refreshTree,
    repositoryRegistry,
    worktreeOrders,
    terminalOrders,
    tmux,
    activeWorktrees,
    switcher,
    detachedOpener,
    revealRepository,
    repositoryCommonDirCache,
  );
  const removeWorktree = new WorktreeRemovalCommand(
    activeWorktrees,
    refreshTree,
    branchDeletionPreferences,
    worktreeListCache,
    repositoryCommonDirCache,
    terminalCascade,
    pendingWorktreeRemovals,
    deckBrowser,
  );
  const removeRepository = new RepositoryRemovalCommand(
    repositoryRegistry,
    activeWorktrees,
    worktreeRoots,
    worktreeOrders,
    refreshTree,
    terminalCascade,
    worktreeListCache,
    deckBrowser,
  );

  treeView = vscode.window.createTreeView('deck.repositories', {
    treeDataProvider: tree,
    dragAndDropController,
    canSelectMany: false,
  });
  const deckDecorationProvider = new DeckDecorationProvider(
    agentStatuses,
    tree.agentStatusDecorationRollups,
    {
      isActiveRepository: (id) => tree.isActiveRepositoryDecorationTarget(id),
      isActiveWorktree: (id) => tree.isActiveWorktreeDecorationTarget(id),
      onDidChange: (listener) => tree.onDidChangeDeckDecorations(listener),
    },
    disconnectedTabs,
    chatStatuses,
  );
  const deckDecorationWatch = vscode.window.registerFileDecorationProvider(deckDecorationProvider);
  const disconnectedTabBadgeWatch = disconnectedTabs.onDidChangeDisconnectedTabs((uris) => {
    deckDecorationProvider.invalidate(uris);
  });
  const agentStatusCollapseWatch = treeView.onDidCollapseElement((event) => {
    deckDecorationProvider.fire(tree.setCollapsed(event.element, true));
  });
  const agentStatusExpandWatch = treeView.onDidExpandElement((event) => {
    deckDecorationProvider.fire(tree.setCollapsed(event.element, false));
  });
  // Kick off the reboot restore after the tree view exists so restore feedback
  // can show the sidebar banner while the snapshot is being restored.
  const activationRestore = restoreCoordinator?.ensureRestored();
  if (activationRestore) {
    void activationRestore
      .then(refreshTree)
      .catch((error) => {
        console.warn('Deck: refreshing tree after TerminalSnapshot restore failed', error);
      })
      .finally(startAgentExitSweep);
  } else {
    startAgentExitSweep();
  }
  const agentStatusNotifierWatch = new AgentStatusNotifier({
    store: agentStatuses,
    settings: {
      notifyOnNeedsInput: () => agentStatusNotificationEnabled('notifyOnNeedsInput'),
      notifyOnCompleted: () => agentStatusNotificationEnabled('notifyOnCompleted'),
    },
    windowState: {
      isFocused: () => vscode.window.state.focused,
      activeTerminalSessionName: () => activeDeckTerminal()?.sessionName,
    },
    notifications: {
      showWarningMessage: (message, ...items) => vscode.window.showWarningMessage(message, ...items),
      showInformationMessage: (message, ...items) => vscode.window.showInformationMessage(message, ...items),
    },
    openTerminal: (sessionName) => openAgentStatusTerminal(tree, treeView, openTerminal, sessionName),
    resolveTerminalSession: (sessionName) => tmux.terminalSession(sessionName),
    describeSession: (sessionName) => tree.describeSession(sessionName),
  }).start();
  const chatSessionOpenDeps = {
    isExtensionInstalled: (extensionId: string) => vscode.extensions.getExtension(extensionId) !== undefined,
    showExtensionMissing: () =>
      void vscode.window.showWarningMessage('Install the Claude Code extension to open this chat session.'),
    currentWorkspacePath: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    reveal: (sessionId: string) =>
      void vscode.commands.executeCommand('claude-vscode.editor.open', sessionId, undefined, vscode.ViewColumn.Active),
    openInWorktreeWindow: async (target: OpenChatSessionTarget) => {
      // Queue the reveal keyed by worktree, then bring up that worktree's window.
      // The target window resumes the session on activation (a fresh window) or
      // when it next gains focus (VS Code focuses an already-open folder window),
      // where the session's own folder is mounted so it resumes with history.
      await pendingChatOpens.set(target.worktreePath, target.sessionId);
      await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(target.worktreePath), {
        forceNewWindow: true,
      });
    },
  };
  // ChatSessions get the same needs-input / finished toasts as Terminals. There
  // is no active-tab suppression: a webview tab exposes no session id, so Deck
  // cannot tell which ChatSession is in front — it always notifies.
  const chatStatusNotifierWatch = new AgentStatusNotifier({
    store: chatStatuses,
    settings: {
      notifyOnNeedsInput: () => agentStatusNotificationEnabled('notifyOnNeedsInput'),
      notifyOnCompleted: () => agentStatusNotificationEnabled('notifyOnCompleted'),
    },
    windowState: {
      isFocused: () => vscode.window.state.focused,
      activeTerminalSessionName: () => undefined,
    },
    notifications: {
      showWarningMessage: (message, ...items) => vscode.window.showWarningMessage(message, ...items),
      showInformationMessage: (message, ...items) => vscode.window.showInformationMessage(message, ...items),
    },
    actionLabel: 'Open',
    openTerminal: (sessionId) => {
      const context = tree.chatSessionContext(sessionId);
      if (context) void openChatSession(context.target, chatSessionOpenDeps);
    },
    resolveLabel: async (sessionId) => tree.chatSessionContext(sessionId)?.title,
    describeSession: async (sessionId) => tree.chatSessionContext(sessionId)?.location,
  }).start();
  const addRepository = new AddRepositoryCommand(
    new VsCodeRepositoryFolderPicker(),
    repositoryRegistry,
    activeWorktrees,
    switcher,
    detachedOpener,
    refreshTree,
    revealRepository,
    repositoryCommonDirCache,
  );

  // This window's own open Claude chat titles, kept so the store's union (which
  // arrives from other windows via the watch) can be merged with them on demand.
  let localOpenChatTitles: ReadonlySet<string> = new Set();
  // The tree sees this window's tabs unioned with every other window's — the
  // local set immediately, the rest as their watch fires. So a session open here
  // is badged at once, and one open elsewhere as soon as that window publishes.
  const pushOpenChatSessionWindows = (): void => {
    tree.setOpenChatSessionWindows(new Set([...localOpenChatTitles, ...openChatWindows.union()]));
  };
  const syncOpenChatSessionWindows = (): void => {
    // Read tab.input structurally by its viewType, matching findTerminalTabColumn
    // — a webview panel's TabInputWebview exposes viewType, and the Claude panel's
    // is namespaced (e.g. mainThreadWebview-claudeVSCodePanel), matched by substring.
    const tabs = vscode.window.tabGroups.all.flatMap((group) =>
      group.tabs.map((tab) => {
        const input = tab.input as { viewType?: unknown } | undefined;
        return {
          label: tab.label,
          viewType: typeof input?.viewType === 'string' ? input.viewType : undefined,
        };
      }),
    );
    localOpenChatTitles = collectOpenChatWindowTitles(tabs);
    // Publish this window's set so other windows see it; ignore write failures —
    // the union still reflects the local set through pushOpenChatSessionWindows.
    void openChatWindows.publish([...localOpenChatTitles]).catch(() => undefined);
    pushOpenChatSessionWindows();
  };
  const openChatWindowsChangeWatch = openChatWindows.onDidChange(pushOpenChatSessionWindows);
  // Rewrite this window's entry periodically so an open-but-idle window (no tab
  // changes) stays fresh and its sessions don't age past the store's TTL.
  const openChatHeartbeat = setInterval(() => {
    void openChatWindows.heartbeat().catch(() => undefined);
  }, 60_000);
  syncOpenChatSessionWindows();

  let lastRevealedActiveTerminalSessionName: string | undefined;
  const revealActiveTerminalAfterNavigation = async () => {
    const activeTerminalSessionName = activeDeckTerminal()?.sessionName;
    // VS Code also emits tab changes for Deck's agent icon/title churn, not
    // just navigation. Only reselect the tree row when the active Terminal
    // identity changes, so status/title updates don't steal manual selection.
    if (activeTerminalSessionName === lastRevealedActiveTerminalSessionName) return;
    lastRevealedActiveTerminalSessionName = activeTerminalSessionName;
    await revealActiveTerminalInTree(tree, treeView);
  };

  context.subscriptions.push(
    treeView,
    agentStatusWatch,
    chatSessionWatch,
    chatStatusWatch,
    openChatWindowWatch,
    openChatWindowsChangeWatch,
    { dispose: () => clearInterval(openChatHeartbeat) },
    activeChatReadWatch,
    pendingChatWatch,
    // An already-open worktree window resumes a queued ChatSession the instant
    // another window writes it (the file watcher fires), not only when focused.
    pendingChatOpens.onDidChange(() => {
      void openPendingChatSessionForCurrentWorktree(pendingChatOpens);
    }),
    activeTerminalReadWatch,
    agentExitSweepWakeWatch,
    ...(agentExitSweep ? [agentExitSweep] : []),
    ...(terminalPoll ? [terminalPoll] : []),
    ...(terminalPollWatch ? [terminalPollWatch] : []),
    ...(terminalPollSessionSetWatch ? [terminalPollSessionSetWatch] : []),
    browserPoll,
    deckDecorationProvider,
    deckDecorationWatch,
    disconnectedTabBadgeWatch,
    agentStatusCollapseWatch,
    agentStatusExpandWatch,
    agentStatusNotifierWatch,
    chatStatusNotifierWatch,
    externalGitWatch,
    vscode.window.registerCustomEditorProvider(terminalEditorViewType, terminalEditorProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
      supportsMultipleEditorsPerDocument: false,
    }),
    terminalEditorProvider,
    disconnectedTabs,
    vscode.commands.registerCommand('deck.refresh', () => {
      refreshTree();
    }),
    // The title-bar toggle writes the preference; onDidChangeConfiguration applies
    // it, so the button and a Settings edit converge on one path.
    vscode.commands.registerCommand('deck.showClosedChatSessions', () =>
      deckConfig().update('showClosedChatSessions', true, vscode.ConfigurationTarget.Global),
    ),
    vscode.commands.registerCommand('deck.hideClosedChatSessions', () =>
      deckConfig().update('showClosedChatSessions', false, vscode.ConfigurationTarget.Global),
    ),
    vscode.commands.registerCommand('deck.addRepository', () => addRepository.run()),
    vscode.commands.registerCommand('deck.addWorktree', (node) => addWorktree.run(node)),
    vscode.commands.registerCommand('deck.addTerminal', (node) => addTerminal.run(node)),
    vscode.commands.registerCommand('deck.runLauncher', (node) => runLauncher.run(node)),
    vscode.commands.registerCommand('deck.openTerminal', (node) => openTerminal.run(node)),
    vscode.commands.registerCommand('deck.openChatSession', async (target: OpenChatSessionTarget) => {
      await openChatSession(target, chatSessionOpenDeps);
      // Opening a session is reading it — clear its unread "finished" mark.
      void chatStatuses.markRead(target.sessionId);
    }),
    // Row click passes {worktreePath, previewName}; the definition is resolved
    // from the (already-cached, since the row is showing) PreviewStore.
    vscode.commands.registerCommand('deck.openPreview', async (target: { worktreePath: string; previewName: string }) => {
      const def = previewStore.forWorktree(target.worktreePath).find((preview) => preview.name === target.previewName);
      if (def === undefined) return;
      await deckBrowser.openOrReveal(target.worktreePath, def);
      browserPoll.start();
    }),
    // Context-menu commands receive the PreviewWindowNode (worktreePath + def).
    vscode.commands.registerCommand('deck.closePreview', async (node: { worktreePath: string; def: PreviewDefinition }) => {
      await deckBrowser.close(node.worktreePath, node.def);
      browserPoll.start();
    }),
    vscode.commands.registerCommand('deck.reloadPreview', (node: { worktreePath: string; def: PreviewDefinition }) =>
      deckBrowser.reload(node.worktreePath, node.def),
    ),
    vscode.commands.registerCommand('deck.copyPreviewUrl', (node: { worktreePath: string; def: PreviewDefinition }) =>
      vscode.env.clipboard.writeText(previewUrl(node.worktreePath, node.def)),
    ),
    vscode.commands.registerCommand('deck.runPreview', (node) => runPreview.run(node)),
    vscode.commands.registerCommand('deck.openTerminalInNewWindow', (node) =>
      openTerminalInNewWindow.run(node),
    ),
    // cmd+backspace (keybinding) passes no node, so fall back to the selected
    // row. Scoped to Terminals only: a Worktree row can't be selected by keyboard
    // without switching (its click reloads the window), and VS Code gives no API
    // to read the keyboard-focused tree item (microsoft/vscode#130880) — so
    // Worktree delete lives in the right-click menu, which does receive the row.
    vscode.commands.registerCommand('deck.killTerminal', (node) =>
      terminalRemoval.run(node ?? treeView.selection[0]),
    ),
    vscode.commands.registerCommand('deck.terminal.find', () => terminalEditorProvider.showFind()),
    vscode.commands.registerCommand('deck.reopenTerminals', () => disconnectedTabs.reopenUnwiredTabs()),
    vscode.commands.registerCommand('deck.installAgentHooks', () => agentSetupPrompt.run({ explicit: true })),
    vscode.commands.registerCommand('deck.removeAgentHooks', () => agentSetupPrompt.uninstall()),
    vscode.commands.registerCommand('deck.removeRepository', (node) => removeRepository.run(node)),
    vscode.commands.registerCommand('deck.removeWorktree', (node) => removeWorktree.run(node)),
    vscode.commands.registerCommand('deck.openWorktreeInNewWindow', (node: { worktree: { path: string } }) =>
      detachedOpener.open(node.worktree.path),
    ),
    vscode.commands.registerCommand('deck.switchWorktree', async (node: { worktree: { path: string } }) => {
      await switcher.switchTo(node.worktree.path);
      refreshTree();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(refreshTree),
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      // PreviewDefinitions live in settings — re-resolve rows when they change.
      if (event.affectsConfiguration('deck.previews') || event.affectsConfiguration('deck.repositoryPreviews')) {
        previewStore.invalidate();
      }
      if (event.affectsConfiguration('deck.showClosedChatSessions')) {
        await applyShowClosedChatSessions();
      }
      if (!event.affectsConfiguration('deck.tmux')) return;
      const tmuxOptions = deckTmuxOptionsFromSettings();
      showDeckTmuxOptionWarnings(tmuxOptions);
      await writeDeckConf(context, tmuxOptions);
      await applyDeckTmuxOptionsIfServerRunning(tmux, tmuxOptions, tmuxAvailability.available);
    }),
    vscode.window.tabGroups.onDidChangeTabs(async () => {
      syncOpenChatSessionWindows();
      await markActiveTerminalRead(agentStatuses);
      await markActiveChatSessionRead(chatStatuses, chatSessions);
      await revealActiveTerminalAfterNavigation();
    }),
    vscode.window.tabGroups.onDidChangeTabGroups(async () => {
      syncOpenChatSessionWindows();
      await markActiveTerminalRead(agentStatuses);
      await markActiveChatSessionRead(chatStatuses, chatSessions);
      await revealActiveTerminalAfterNavigation();
    }),
    // Focusing back with the agent's tab active is when you actually read it —
    // markActive*Read no-op while unfocused, so re-run them on refocus.
    vscode.window.onDidChangeWindowState((state) => {
      if (!state.focused) return;
      refreshTree();
      void markActiveTerminalRead(agentStatuses);
      void markActiveChatSessionRead(chatStatuses, chatSessions);
      // An already-open worktree window that VS Code just focused (instead of
      // duplicating) resumes any ChatSession queued for it by another window.
      void openPendingChatSessionForCurrentWorktree(pendingChatOpens);
      // Re-resolve PreviewDefinitions so committed `.deck/previews.json` edits
      // made outside this window are picked up on refocus.
      previewStore.invalidate();
    }),
    treeView.onDidChangeVisibility((event) => {
      if (event.visible) refreshTree();
    }),
  );
  disconnectedTabs.start();
  // ChatSession opens need no tmux, so resume a queued one regardless of whether
  // the terminal snapshot machinery is available.
  await openPendingChatSessionForCurrentWorktree(pendingChatOpens);
  if (terminalSnapshotRuntime) {
    context.subscriptions.push(terminalSnapshotRuntime.startPeriodicSave(5 * 60 * 1000));
    await openPendingTerminalForCurrentWorktree(pendingTerminalOpens, tmux);
    await activationRestore?.catch(() => undefined);
    hookInstaller.reconcileInstalledHooks().then(showAgentHookUpgradeNotifications).catch((error) =>
      console.warn('Deck: reconciling agent hooks failed', error),
    );
    // Agent resume rides on the tmux-backed snapshot machinery, so only offer
    // setup when that's available.
    void agentSetupPrompt.run();
  }
}

export function deactivate(): Promise<void> | undefined {
  const runtime = terminalSnapshotRuntime;
  terminalSnapshotRuntime = undefined;

  // Returned so VS Code awaits the final save within its shutdown budget;
  // still best-effort — a hard crash never calls deactivate at all.
  return runtime?.save().catch((error) => {
    console.warn('Deck: saving TerminalSnapshot during deactivate failed', error);
  });
}

async function writeDeckConf(
  context: vscode.ExtensionContext,
  tmuxOptions: DeckTmuxOptions = deckTmuxOptionsFromSettings(),
): Promise<string> {
  const templatePath = join(context.extensionPath, 'resources', 'deck.conf');
  const dataDir = deckDataDir();
  const generatedPath = join(dataDir, 'deck.conf');
  const resurrectDir = join(dataDir, 'resurrect');
  const pluginPath = tmuxResurrectPath(context, 'resurrect.tmux');

  const template = await readFile(templatePath, 'utf8');
  // resurrectDir is under dataDir, so this creates both.
  await mkdir(resurrectDir, { recursive: true });
  await writeFile(generatedPath, renderDeckConf(template, { pluginPath, resurrectDir }, tmuxOptions), 'utf8');
  return generatedPath;
}

async function socketExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function deckTmuxOptionsFromSettings(): DeckTmuxOptions {
  const config = vscode.workspace.getConfiguration('deck.tmux');
  return resolveDeckTmuxOptions({
    automaticRenameFormat: config.get<string>('automaticRenameFormat'),
  });
}

function showDeckTmuxOptionWarnings(tmuxOptions: DeckTmuxOptions): void {
  for (const warning of tmuxOptions.warnings) {
    void vscode.window.showWarningMessage(warning);
  }
}

async function applyDeckTmuxOptionsIfServerRunning(
  tmux: TmuxCli,
  tmuxOptions: DeckTmuxOptions,
  tmuxAvailable: boolean,
): Promise<void> {
  try {
    if (!tmuxAvailable || !(await tmux.isServerRunning())) return;

    for (const option of tmuxOptions.options) {
      if (option.value === null) await tmux.unsetOption(option.option);
      else await tmux.setOption(option.option, option.value);
    }
  } catch (error) {
    console.warn('Deck: applying tmux options failed', error);
  }
}

function terminalSnapshotSaveScriptPath(context: vscode.ExtensionContext): string {
  return tmuxResurrectPath(context, 'scripts', 'save.sh');
}

function terminalSnapshotRestoreScriptPath(context: vscode.ExtensionContext): string {
  return tmuxResurrectPath(context, 'scripts', 'restore.sh');
}

function tmuxResurrectPath(context: vscode.ExtensionContext, ...parts: string[]): string {
  return join(context.extensionPath, 'resources', 'plugins', 'tmux-resurrect', ...parts);
}

function terminalSnapshotRestoreFeedback(
  deckDir: string,
  currentTreeView: () => vscode.TreeView<RepositoryTreeNode> | undefined,
): TerminalSnapshotRestoreFeedback {
  return {
    withProgress: async (context, task) => {
      const treeView = currentTreeView();
      if (treeView) treeView.message = 'Restoring terminals…';
      try {
        const copy = formatTerminalSnapshotRestoreProgress({
          unresponsive: context.unresponsive,
          lastSavedAt: await terminalSnapshotLastSaveTime(deckDir),
        });
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: copy.title,
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: copy.message });
            await task();
          },
        );
      } finally {
        if (treeView) treeView.message = undefined;
      }
    },
  };
}

// Deck's machine-global runtime dir, holding the generated DeckSocket conf and
// the TerminalSnapshot. Deliberately NOT globalStorage: the DeckSocket
// (`-L deck`) is one tmux server per user, but globalStorage is per-install
// (VS Code Stable and Insiders would generate competing conf/snapshots for the
// one shared socket) and, on macOS, lives under "~/Library/Application
// Support/…" whose space breaks tmux-resurrect's restore.sh. A space-free
// machine-global dir matches the machine-global socket. Isolated from the
// user's own ~/.local/share/tmux/resurrect.
function deckDataDir(): string {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(dataHome, 'deck');
}

function resumeTemplateFromSettings(): ResumeTemplate {
  const config = vscode.workspace.getConfiguration('deck');
  return new ResumeTemplate({
    claude: config.get<string>('agentResumeTemplates.claude'),
    codex: config.get<string>('agentResumeTemplates.codex'),
  });
}

function agentStatusNotificationEnabled(key: 'notifyOnNeedsInput' | 'notifyOnCompleted'): boolean {
  return vscode.workspace.getConfiguration('deck').get<boolean>(key, true);
}

interface RepositoryRegistryReader {
  list(): readonly string[];
}

async function registeredCommonDirs(
  repositoryRegistry: RepositoryRegistryReader,
  repositoryCommonDirCache: RepositoryCommonDirCache,
): Promise<Set<string>> {
  const commonDirs = await Promise.all(
    repositoryRegistry.list().map((repositoryPath) =>
      resolveCommonDirSafe(repositoryCommonDirCache, repositoryPath),
    ),
  );
  return new Set(commonDirs.filter((commonDir): commonDir is string => commonDir !== null));
}

async function showAgentHookUpgradeNotifications(configs: readonly HookReconcileResult[]): Promise<void> {
  // Unchained: an ignored toast's promise stays pending until dismissed, so a
  // sequential loop could hold back the next agent's toast indefinitely.
  await Promise.all(configs.map(async (config) => {
    const reviewChanges = 'Review Changes';
    const choice = await vscode.window.showInformationMessage(
      `Deck updated its ${agentHookProductName(config.agent)} hooks for this Deck version`,
      reviewChanges,
    );
    if (choice === reviewChanges) await showAgentHookConfigChanges([config]);
  }));
}

async function showAgentHookConfigChanges(configs: readonly AgentConfigChange[]): Promise<void> {
  for (const { agent, configPath } of configs) {
    const current = vscode.Uri.file(configPath);
    const backup = vscode.Uri.file(`${configPath}.deck.bak`);
    const title = `Deck ${agent === 'claude' ? 'Claude' : 'Codex'} hooks (before ↔ after)`;
    try {
      await vscode.workspace.fs.stat(backup);
      await vscode.commands.executeCommand('vscode.diff', backup, current, title);
    } catch {
      // No backup (config was absent before) — just open the new file.
      await vscode.window.showTextDocument(current);
    }
  }
}

function agentHookProductName(agent: HookReconcileResult['agent']): string {
  return agent === 'claude' ? 'Claude Code' : 'Codex';
}

// Mirrors the Explorer's delete confirmation (a modal warning gated by a
// setting). The webview API has no in-dialog "do not ask again" checkbox, so
// `deck.confirmTerminalDelete` carries that effect instead.
async function confirmTerminalRemoval(label: string): Promise<boolean> {
  if (vscode.workspace.getConfiguration('deck').get<boolean>('confirmTerminalDelete', true) === false) {
    return true;
  }
  // Information (not warning) so the dialog has no orange warning icon, matching
  // the Explorer's plain delete confirmation.
  const choice = await vscode.window.showInformationMessage(
    `Are you sure you want to delete the terminal '${label}'?`,
    { modal: true, detail: 'The shell and any running process will be terminated.' },
    'Delete',
  );
  return choice === 'Delete';
}

async function revealActiveTerminalInTree(
  tree: RepositoryTreeProvider,
  treeView: vscode.TreeView<RepositoryTreeNode>,
): Promise<void> {
  const decoded = activeDeckTerminal();
  if (!decoded) return;

  let terminalNode: RepositoryTreeNode | undefined;
  try {
    // findTerminal walks getChildren (a git subprocess) and can fail on a hidden
    // view; this should not surface as an unhandled rejection from a tab event.
    terminalNode = await tree.findTerminal(decoded.sessionName, decoded.worktreePath);
  } catch (error) {
    console.warn('Deck: finding the active terminal failed', error);
    return;
  }
  if (!terminalNode) return;

  const node = terminalNode;
  const revealed = await revealWithRetry(() =>
    treeView.reveal(node, { select: true, focus: false }),
  );
  if (!revealed) console.warn('Deck: revealing the active terminal failed after retries');
}

async function openAgentStatusTerminal(
  tree: RepositoryTreeProvider,
  treeView: vscode.TreeView<RepositoryTreeNode>,
  openTerminal: OpenTerminalCommand,
  sessionName: string,
): Promise<void> {
  try {
    const terminalNode = await tree.findTerminalBySessionName(sessionName);
    if (!terminalNode || !('terminal' in terminalNode)) {
      // Status files are machine-global; this window's tree only shows
      // registered repositories (e.g. another VS Code install owns this one).
      await vscode.window.showInformationMessage(
        "This Terminal's repository isn't registered in this window. Add the repository to Deck to open it.",
      );
      return;
    }
    await openTerminal.run(terminalNode);
    await treeView.reveal(terminalNode, { select: true, focus: false });
  } catch (error) {
    console.warn('Deck: opening agent status Terminal failed', error);
  }
}

function activeDeckTerminal(): { sessionName: string; worktreePath: string } | undefined {
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = activeTab?.input as { viewType?: unknown; uri?: vscode.Uri } | undefined;
  if (input?.viewType !== terminalEditorViewType || !input.uri) return undefined;

  try {
    return new SessionUriCodec().decode(input.uri);
  } catch {
    return undefined;
  }
}

async function markActiveTerminalRead(
  agentStatuses: Pick<AgentStatusStore, 'markRead'>,
): Promise<void> {
  // Only "read" when you're actually looking: the window must be focused, not
  // merely have the terminal parked as its active tab. Otherwise a completed
  // turn in a background window's active tab would be marked read everywhere
  // (read state is machine-global), clearing the unread dot you never saw.
  if (!vscode.window.state.focused) return;
  const activeTerminal = activeDeckTerminal();
  if (!activeTerminal) return;

  try {
    await agentStatuses.markRead(activeTerminal.sessionName);
  } catch (error) {
    console.warn('Deck: marking active Terminal agent status read failed', error);
  }
}

// Clears a ChatSession's unread (blue "finished") mark once you're looking at it:
// the window is focused and the active editor tab is that session's Claude webview.
// The tab exposes only its (possibly truncated) title, so the session is matched
// by title — the same way its open state is detected.
async function markActiveChatSessionRead(
  chatStatuses: Pick<AgentStatusStore, 'markRead'>,
  chatSessions: { all(): readonly ChatSession[] },
): Promise<void> {
  if (!vscode.window.state.focused) return;
  const activeTab = vscode.window.tabGroups.activeTabGroup?.activeTab;
  const input = activeTab?.input as { viewType?: unknown } | undefined;
  if (activeTab === undefined || typeof input?.viewType !== 'string') return;
  if (!input.viewType.includes('claudeVSCodePanel')) return;

  const session = chatSessions
    .all()
    .find((candidate) => candidate.title !== undefined && chatWindowTitleMatches(activeTab.label, candidate.title));
  if (session === undefined) return;

  try {
    await chatStatuses.markRead(session.sessionId);
  } catch (error) {
    console.warn('Deck: marking active Claude chat session read failed', error);
  }
}

interface PendingTerminalOpenConsumer {
  consume(worktreePath: string): Promise<string | undefined>;
}

interface PendingChatOpenQueue {
  consume(worktreePath: string): Promise<string | undefined>;
  set(worktreePath: string, sessionId: string): Promise<void>;
}

// Resumes a ChatSession queued by another window's cross-worktree open. Runs when
// this window mounts its worktree (fresh window) and whenever it regains focus (an
// already-open folder window VS Code focused instead of duplicating). The session
// resumes with history because this window's folder is its own worktree.
//
// The Claude extension activates in parallel on a fresh window, so its
// `editor.open` command may not be registered yet — Deck awaits its activation
// first, and if the reveal still fails, re-queues the open so the next activation
// or focus retries instead of dropping it.
export async function openPendingChatSessionForCurrentWorktree(
  pendingChatOpens: PendingChatOpenQueue,
): Promise<void> {
  const worktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!worktreePath) return;
  const extension = vscode.extensions.getExtension('anthropic.claude-code');
  if (extension === undefined) return;

  const sessionId = await pendingChatOpens.consume(worktreePath);
  if (!sessionId) return;

  try {
    if (!extension.isActive) await extension.activate();
    await vscode.commands.executeCommand(
      'claude-vscode.editor.open',
      sessionId,
      undefined,
      vscode.ViewColumn.Active,
    );
  } catch (error) {
    await pendingChatOpens.set(worktreePath, sessionId);
    console.warn('Deck: opening pending Claude chat session failed; will retry', error);
  }
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
