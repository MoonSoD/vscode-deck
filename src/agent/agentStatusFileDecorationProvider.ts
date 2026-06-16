import * as vscode from 'vscode';
import type { AgentStatus, Disposable } from './agentStatusStore';
import {
  AgentStatusDecorationRollups,
  agentStatusDecorationUri,
  parseAgentStatusDecorationUri,
  provideAgentStatusDecoration,
} from './agentStatusDecorations';
import { SessionUriCodec, terminalUriScheme } from '../terminal/sessionUriCodec';

interface AgentStatusStoreLike {
  get(sessionName: string): AgentStatus | undefined;
  entries(): IterableIterator<[string, AgentStatus]>;
  onDidChange(listener: () => void): Disposable;
}

export class AgentStatusFileDecorationProvider implements vscode.FileDecorationProvider, Disposable {
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  private readonly statusWatch: Disposable;
  private readonly codec = new SessionUriCodec();

  constructor(
    private readonly store: AgentStatusStoreLike,
    private readonly rollups: AgentStatusDecorationRollups,
  ) {
    this.syncStatuses();
    this.statusWatch = this.store.onDidChange(() => {
      this.syncStatuses();
      this.fire();
    });
  }

  provideFileDecoration(uri: vscode.Uri): vscode.ProviderResult<vscode.FileDecoration> {
    if (uri.scheme === terminalUriScheme) return this.terminalTabDecoration(uri);
    const target = parseAgentStatusDecorationUri(uri);
    if (target === undefined) return undefined;
    const decoration = provideAgentStatusDecoration(
      uri,
      this.rollups.getDecorationStatus(target.kind, target.id),
    );
    if (decoration === undefined) return undefined;
    const fileDecoration = new vscode.FileDecoration(
      decoration.badge,
      decoration.tooltip,
      new vscode.ThemeColor(decoration.colorId),
    );
    fileDecoration.propagate = false;
    return fileDecoration;
  }

  // A Terminal's editor tab carries the same attention dot as its sidebar row:
  // VS Code applies FileDecorations to custom-editor tabs by resource URI, so a
  // deck-terminal tab decodes to its session and reuses the row's status map.
  private terminalTabDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    let sessionName: string;
    try {
      sessionName = this.codec.decode(uri).sessionName;
    } catch {
      return undefined;
    }
    const decoration = provideAgentStatusDecoration(
      agentStatusDecorationUri(sessionName),
      this.store.get(sessionName),
    );
    if (decoration === undefined) return undefined;
    const fileDecoration = new vscode.FileDecoration(
      decoration.badge,
      decoration.tooltip,
      new vscode.ThemeColor(decoration.colorId),
    );
    fileDecoration.propagate = false;
    return fileDecoration;
  }

  fire(): void {
    this._onDidChangeFileDecorations.fire(undefined);
  }

  dispose(): void {
    this.statusWatch.dispose();
    this._onDidChangeFileDecorations.dispose();
  }

  private syncStatuses(): void {
    this.rollups.setStatuses(this.store.entries());
  }
}
