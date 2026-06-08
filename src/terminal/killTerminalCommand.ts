import * as vscode from 'vscode';
import { SessionUriCodec } from './sessionUriCodec';
import { terminalEditorViewType } from './terminalEditorProvider';

export interface CloseTerminalTmuxCli {
  killSession(session: string): Promise<void>;
}

interface TerminalNodeLike {
  terminal: {
    sessionName: string;
  };
}

export class CloseTerminalCommand {
  constructor(
    private readonly tmux: CloseTerminalTmuxCli,
    private readonly refresh: () => void = () => undefined,
    private readonly sessionUriCodec: SessionUriCodec = new SessionUriCodec(),
  ) {}

  async run(node: TerminalNodeLike | undefined): Promise<void> {
    if (!node) return;

    const session = node.terminal.sessionName;
    await this.tmux.killSession(session);
    await this.closeMatchingEditorTab(session);
    this.refresh();
  }

  private async closeMatchingEditorTab(session: string): Promise<void> {
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (this.sessionForTab(tab) !== session) continue;
        await vscode.window.tabGroups.close(tab);
        return;
      }
    }
  }

  private sessionForTab(tab: vscode.Tab): string | undefined {
    const input = tab.input as { viewType?: unknown; uri?: vscode.Uri } | undefined;
    if (input?.viewType !== terminalEditorViewType || !input.uri) return undefined;

    try {
      return this.sessionUriCodec.decode(input.uri).sessionName;
    } catch {
      return undefined;
    }
  }
}

export type KillTerminalTmuxCli = CloseTerminalTmuxCli;
export { CloseTerminalCommand as KillTerminalCommand };
