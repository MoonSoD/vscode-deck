import * as vscode from 'vscode';
import { SessionUriCodec } from './sessionUriCodec';
import { terminalSessionPrefix } from './tmuxSafe';

const terminalEditorViewType = 'deck.terminal';

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
    this.disposeLegacyTerminals(worktreePath);
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
    const input = tab.input as { viewType?: unknown; uri?: vscode.Uri };
    if (input.viewType !== terminalEditorViewType || !input.uri) return undefined;

    try {
      return this.sessionUriCodec.decode(input.uri).sessionName;
    } catch {
      return undefined;
    }
  }

  private disposeLegacyTerminals(worktreePath: string): void {
    if (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath !== worktreePath) return;

    for (const terminal of vscode.window.terminals) {
      if (!isLegacyDeckTerminalName(terminal.name)) continue;
      try {
        terminal.dispose();
      } catch {
        // Cascade cleanup is best-effort; removal must still proceed.
      }
    }
  }
}

function isLegacyDeckTerminalName(name: string): boolean {
  const match = /^(\d+)\s+\S+/.exec(name);
  if (!match) return false;
  const n = Number(match[1]);
  return Number.isInteger(n);
}
