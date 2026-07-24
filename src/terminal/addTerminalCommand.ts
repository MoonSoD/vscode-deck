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
  ensureSession(session: string, cwd: string, env?: Record<string, string>): Promise<void>;
}

// Resolves the PreviewPort env vars to inject into a new Terminal for a Worktree.
// Defaults to none, so terminal creation is unchanged when no previews declare a
// portEnv (or the browser subsystem isn't wired).
export type ResolvePreviewEnv = (worktreePath: string) => Promise<Record<string, string>>;

const NO_PREVIEW_ENV: ResolvePreviewEnv = async () => ({});

export interface WorktreeNodeLike {
  worktree: {
    path: string;
  };
}

export async function createAndOpenTerminal(
  tmux: AddTerminalTmuxCli,
  node: WorktreeNodeLike,
  sessionUriCodec: SessionUriCodec,
  env: Record<string, string> = {},
): Promise<string> {
  const { session, term } = await createHeadlessTerminal(tmux, node, env);

  await vscode.commands.executeCommand(
    'vscode.openWith',
    sessionUriCodec.encode({ worktreePath: node.worktree.path, term }),
    'deck.terminal',
    { viewColumn: vscode.ViewColumn.Active },
  );
  return session;
}

export async function createHeadlessTerminal(
  tmux: AddTerminalTmuxCli,
  node: WorktreeNodeLike,
  env: Record<string, string> = {},
): Promise<{ session: string; term: number }> {
  const prefix = terminalSessionPrefix(node.worktree.path);
  const existing = await tmux.listSessions(prefix);
  const term = allocateTermN(node.worktree.path, existing.map((session) => session.sessionName));
  const session = terminalSessionName(node.worktree.path, term);
  await tmux.ensureSession(session, node.worktree.path, env);

  return { session, term };
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
    private readonly resolvePreviewEnv: ResolvePreviewEnv = NO_PREVIEW_ENV,
  ) {}

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    await this.beforeCreate();
    const env = await this.resolvePreviewEnv(node.worktree.path);
    await createAndOpenTerminal(this.tmux, node, this.sessionUriCodec, env);
    this.refresh();
  }
}
