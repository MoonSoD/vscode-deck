import * as vscode from 'vscode';
import { SessionUriCodec } from './sessionUriCodec';
import { terminalEditorViewType } from './terminalEditorProvider';
import { terminalSessionPrefix } from './tmuxSafe';

interface TmuxLike {
  listSessions(): Promise<Array<{ sessionName: string }>>;
  killSession(session: string): Promise<void>;
}

export class TerminalCascade {
  constructor(
    private readonly tmux: TmuxLike,
    private readonly sessionUriCodec: SessionUriCodec = new SessionUriCodec(),
  ) {}

  async killWorktree(worktreePath: string): Promise<void> {
    const prefix = terminalSessionPrefix(worktreePath);
    const sessions = await this.tmux.listSessions();

    for (const session of sessions) {
      if (!session.sessionName.startsWith(prefix)) continue;
      try {
        await this.tmux.killSession(session.sessionName);
      } catch {
        // Cascade cleanup is best-effort; removal must still proceed.
      }
    }

    await this.closeCustomEditorTabs(prefix);
  }

  private async closeCustomEditorTabs(prefix: string): Promise<void> {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        const sessionName = this.customEditorSessionName(tab);
        if (!sessionName?.startsWith(prefix)) continue;
        try {
          await vscode.window.tabGroups.close(tab);
        } catch {
          // Cascade cleanup is best-effort; removal must still proceed.
        }
      }
    }
  }

  private customEditorSessionName(tab: vscode.Tab): string | undefined {
    const input = tab.input as { viewType?: unknown; uri?: vscode.Uri } | undefined;
    if (input?.viewType !== terminalEditorViewType || !input.uri) return undefined;

    try {
      return this.sessionUriCodec.decode(input.uri).sessionName;
    } catch {
      return undefined;
    }
  }
}
