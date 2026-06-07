import * as path from 'node:path';
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

interface PendingTerminalOpenStoreLike {
  set(worktreePath: string, sessionName: string): Promise<void>;
}

interface WorktreeSwitcherLike {
  switchTo(worktreePath: string): Promise<void>;
}

interface TerminalEditorPanelLike {
  reveal(): void;
}

interface TerminalEditorPanelRegistryLike {
  panelFor(sessionName: string): TerminalEditorPanelLike | undefined;
}

interface OpenTerminalCommandOptions {
  pendingTerminalOpens?: PendingTerminalOpenStoreLike;
  switcher?: WorktreeSwitcherLike;
  terminalPanels?: TerminalEditorPanelRegistryLike;
}

export class OpenTerminalCommand {
  constructor(
    private readonly options: OpenTerminalCommandOptions = {},
    private readonly sessionUriCodec: SessionUriCodec = new SessionUriCodec(),
  ) {}

  async run(node: TerminalNodeLike | undefined): Promise<void> {
    if (!node) return;
    if (await this.switchForForeignWorktree(node)) return;

    const existing = this.options.terminalPanels?.panelFor(node.terminal.sessionName);
    if (existing) {
      existing.reveal();
      return;
    }

    const cwd = node.worktreePath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd) return;

    await vscode.commands.executeCommand(
      'vscode.openWith',
      this.sessionUriCodec.encode({ sessionName: node.terminal.sessionName, cwd }),
      terminalEditorViewType,
      { viewColumn: vscode.ViewColumn.Active },
    );
  }

  private async switchForForeignWorktree(node: TerminalNodeLike): Promise<boolean> {
    const currentWorktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!currentWorktreePath || !node.worktreePath) return false;
    // Normalize so a trailing slash on one side doesn't trigger a spurious switch.
    if (path.resolve(node.worktreePath) === path.resolve(currentWorktreePath)) return false;
    if (!this.options.pendingTerminalOpens || !this.options.switcher) return false;

    await this.options.pendingTerminalOpens.set(node.worktreePath, node.terminal.sessionName);
    await this.options.switcher.switchTo(node.worktreePath);
    return true;
  }
}
