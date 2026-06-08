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
  ) {}

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

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
