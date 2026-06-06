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
  ensureSessionWindow(session: string, windowName: string, cwd: string): Promise<void>;
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
    const windowName = `term-${termN}`;
    const session = terminalSessionName(node.worktree.path, termN);
    await this.tmux.ensureSessionWindow(session, windowName, node.worktree.path);
    await this.terminalSessionListCache.set(
      cacheKey,
      toCachedTerminalSessions(node.worktree.path, [
        ...existing,
        { sessionName: session, windowName },
      ]),
    );

    const terminal = vscode.window.createTerminal({
      name: `Deck ${windowName}`,
      shellPath: 'tmux',
      shellArgs: this.tmux.attachShellArgs(session),
      location: { viewColumn: vscode.ViewColumn.Active },
    });
    this.registry.set(session, terminal);
    terminal.show(true);
    this.refresh();
  }
}
