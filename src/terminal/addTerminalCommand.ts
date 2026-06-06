import * as vscode from 'vscode';
import { allocateTermN, terminalSessionName, terminalSessionPrefix } from './tmuxSafe';
import { TerminalSessionRegistry } from './terminalSessionRegistry';
import type { TmuxSession } from './tmuxCli';

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
  ) {}

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    const existing = await this.tmux.listSessions(terminalSessionPrefix(node.worktree.path));
    const termN = allocateTermN(node.worktree.path, existing.map((session) => session.sessionName));
    const windowName = `term-${termN}`;
    const session = terminalSessionName(node.worktree.path, termN);
    await this.tmux.ensureSessionWindow(session, windowName, node.worktree.path);

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
