import * as vscode from 'vscode';
import {
  allocateTermN,
  terminalSessionName,
  terminalSessionPrefix,
} from './tmuxSafe';
import type { TmuxSession } from './tmuxCli';
import { SessionUriCodec } from './sessionUriCodec';

export interface AddTerminalTmuxCli {
  listSessions(prefix?: string): Promise<TmuxSession[]>;
  ensureSession(session: string, cwd: string): Promise<void>;
}

interface WorktreeNodeLike {
  worktree: {
    path: string;
  };
}

export class AddTerminalCommand {
  constructor(
    private readonly tmux: AddTerminalTmuxCli,
    private readonly refresh: () => void = () => undefined,
    private readonly sessionUriCodec: SessionUriCodec = new SessionUriCodec(),
    // Awaited before creating a terminal. If the DeckSocket died, this restores
    // the existing TerminalSnapshot first, so a `+` right after a server death
    // adds the new terminal alongside the restored ones instead of starting a
    // lone blank server that the next save would write over the good snapshot.
    private readonly beforeCreate: () => Promise<void> = () => Promise.resolve(),
  ) {}

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    await this.beforeCreate();

    const prefix = terminalSessionPrefix(node.worktree.path);
    const existing = await this.tmux.listSessions(prefix);
    const termN = allocateTermN(node.worktree.path, existing.map((session) => session.sessionName));
    const session = terminalSessionName(node.worktree.path, termN);
    await this.tmux.ensureSession(session, node.worktree.path);

    await vscode.commands.executeCommand(
      'vscode.openWith',
      this.sessionUriCodec.encode({ worktreePath: node.worktree.path, term: termN }),
      'deck.terminal',
      { viewColumn: vscode.ViewColumn.Active },
    );
    this.refresh();
  }
}
