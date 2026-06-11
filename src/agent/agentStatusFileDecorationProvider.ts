import * as vscode from 'vscode';
import type { AgentStatus, Disposable } from './agentStatusStore';
import {
  AgentStatusDecorationRollups,
  parseAgentStatusDecorationUri,
  provideAgentStatusDecoration,
} from './agentStatusDecorations';

interface AgentStatusStoreLike {
  entries(): IterableIterator<[string, AgentStatus]>;
  onDidChange(listener: () => void): Disposable;
}

export class AgentStatusFileDecorationProvider implements vscode.FileDecorationProvider, Disposable {
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  private readonly statusWatch: Disposable;

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
