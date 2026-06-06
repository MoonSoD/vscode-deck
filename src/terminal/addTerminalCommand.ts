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

export class AddTerminalCommand {
  constructor(
    private readonly tmux: AddTerminalTmuxCli,
    private readonly registry: TerminalSessionRegistry = new TerminalSessionRegistry(),
    private readonly refresh: () => void = () => undefined,
    private readonly terminalSessionListCache: Pick<TerminalSessionListCacheStore, 'set'> = {
      set: async () => undefined,
    },
  ) {}

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    const prefix = terminalSessionPrefix(node.worktree.path);
    const cacheKey = terminalWorktreePrefix(node.worktree.path);
    const existing = await this.tmux.listSessions(prefix);
    const termN = allocateTermN(node.worktree.path, existing.map((session) => session.sessionName));
    const session = terminalSessionName(node.worktree.path, termN);
    await this.tmux.ensureSession(session, node.worktree.path);
    // Re-list after creation. tmux's `#{pane_current_command}` is read fresh
    // from the OS on every query, so the new session's row is correct on the
    // first observation — no deferred refresh needed.
    const refreshed = await this.tmux.listSessions(prefix);
    await this.terminalSessionListCache.set(
      cacheKey,
      toCachedTerminalSessions(node.worktree.path, refreshed),
    );
    // Tab title is the index (`Deck 1`, `Deck 2`, …). It correlates with the
    // sidebar's `1 zsh` / `2 claude` rows by number, never goes stale, and
    // doesn't fight VS Code's terminal title machinery: `Terminal.name` is
    // sticky after creation, `${sequence}` (the OSC route) requires users to
    // edit `terminal.integrated.tabs.title`. Sidebar is the canonical
    // "what's running" surface.
    const terminal = vscode.window.createTerminal({
      name: `Deck ${termN}`,
      shellPath: 'tmux',
      shellArgs: this.tmux.attachShellArgs(session),
      location: { viewColumn: vscode.ViewColumn.Active },
    });
    this.registry.set(session, terminal);
    // VS Code: Terminal.show(preserveFocus). false → focus moves to the terminal.
    terminal.show(false);
    this.refresh();
  }
}
