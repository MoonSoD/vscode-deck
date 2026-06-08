import * as vscode from 'vscode';
import { SessionUriCodec } from './sessionUriCodec';
import { terminalEditorViewType } from './terminalEditorProvider';

interface TerminalNodeLike {
  terminal: {
    sessionName: string;
    windowName: string;
  };
  n: number;
  worktreePath?: string;
}

interface TerminalEditorPanelLike {
  reveal(): void;
}

interface TerminalEditorPanelRegistryLike {
  panelFor(sessionName: string): TerminalEditorPanelLike | undefined;
}

export class OpenTerminalCommand {
  constructor(
    private readonly terminalPanels?: TerminalEditorPanelRegistryLike,
    private readonly sessionUriCodec: SessionUriCodec = new SessionUriCodec(),
  ) {}

  async run(node: TerminalNodeLike | undefined): Promise<void> {
    if (!node) return;

    const existing = this.terminalPanels?.panelFor(node.terminal.sessionName);
    if (existing) {
      existing.reveal();
      return;
    }

    const cwd = node.worktreePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) return;

    await vscode.commands.executeCommand(
      'vscode.openWith',
      this.sessionUriCodec.encode({ worktreePath: cwd, term: node.n }),
      terminalEditorViewType,
      { viewColumn: vscode.ViewColumn.Active },
    );
  }
}
