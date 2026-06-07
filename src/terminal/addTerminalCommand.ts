import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  allocateTermN,
  terminalSessionName,
  terminalSessionPrefix,
  terminalWorktreePrefix,
} from './tmuxSafe';
import { TerminalSessionRegistry } from './terminalSessionRegistry';
import type { TmuxSession } from './tmuxCli';
import {
  toCachedTerminalSessions,
  type TerminalSessionListCacheStore,
} from './terminalSessionListCacheStore';
import { SessionUriCodec } from './sessionUriCodec';

export interface AddTerminalTmuxCli {
  listSessions(prefix?: string): Promise<TmuxSession[]>;
  ensureSession(session: string, cwd: string): Promise<void>;
  attachShellArgs(session: string): string[];
}

interface WorktreeNodeLike {
  worktree: {
    path: string;
  };
}

interface PendingTerminalOpenStoreLike {
  set(worktreePath: string, sessionName: string): Promise<void>;
}

interface WorktreeSwitcherLike {
  switchTo(worktreePath: string): Promise<void>;
}

interface AddTerminalCommandOptions {
  pendingTerminalOpens?: PendingTerminalOpenStoreLike;
  switcher?: WorktreeSwitcherLike;
}

export class AddTerminalCommand {
  constructor(
    private readonly tmux: AddTerminalTmuxCli,
    private readonly registry: TerminalSessionRegistry = new TerminalSessionRegistry(),
    private readonly refresh: () => void = () => undefined,
    private readonly terminalSessionListCache: Pick<TerminalSessionListCacheStore, 'set'> = {
      set: async () => undefined,
    },
    private readonly options: AddTerminalCommandOptions = {},
    private readonly sessionUriCodec: SessionUriCodec = new SessionUriCodec(),
  ) {}

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    const prefix = terminalSessionPrefix(node.worktree.path);
    const cacheKey = terminalWorktreePrefix(node.worktree.path);
    const existing = await this.tmux.listSessions(prefix);
    const termN = allocateTermN(node.worktree.path, existing.map((session) => session.sessionName));
    const session = terminalSessionName(node.worktree.path, termN);
    await this.tmux.ensureSession(session, node.worktree.path);
    const refreshed = await this.tmux.listSessions(prefix);
    const cached = toCachedTerminalSessions(node.worktree.path, refreshed);
    await this.terminalSessionListCache.set(cacheKey, cached);

    // Foreign worktree: don't attach a vscode.Terminal in this window — it
    // would land in the wrong workspace folder. Persist the new session as
    // a pending-open intent and switch; post-reload activation opens it.
    if (await this.switchForForeignWorktree(node, session)) return;

    await vscode.commands.executeCommand(
      'vscode.openWith',
      this.sessionUriCodec.encode({ sessionName: session, cwd: node.worktree.path }),
      'deck.terminal',
      { viewColumn: vscode.ViewColumn.Active },
    );
    this.refresh();
  }

  private async switchForForeignWorktree(
    node: WorktreeNodeLike,
    sessionName: string,
  ): Promise<boolean> {
    const currentWorktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!currentWorktreePath) return false;
    if (path.resolve(node.worktree.path) === path.resolve(currentWorktreePath)) return false;
    if (!this.options.pendingTerminalOpens || !this.options.switcher) return false;

    await this.options.pendingTerminalOpens.set(node.worktree.path, sessionName);
    await this.options.switcher.switchTo(node.worktree.path);
    return true;
  }
}
