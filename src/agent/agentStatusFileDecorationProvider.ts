import * as vscode from 'vscode';
import type { AgentStatus, Disposable } from './agentStatusStore';
import {
  AgentStatusDecorationRollups,
  agentStatusDecorationUri,
  parseAgentStatusDecorationUri,
  provideAgentStatusDecoration,
} from './agentStatusDecorations';
import type { AgentStatusDecorationResourceUri } from './agentStatusDecorationUris';
import { SessionUriCodec, terminalUriScheme } from '../terminal/sessionUriCodec';

interface AgentStatusChange {
  sessionNames: readonly string[];
}

interface AgentStatusStoreLike {
  get(sessionName: string): AgentStatus | undefined;
  entries(): IterableIterator<[string, AgentStatus]>;
  onDidChange(listener: (change: AgentStatusChange) => void): Disposable;
}

export class AgentStatusFileDecorationProvider implements vscode.FileDecorationProvider, Disposable {
  private readonly _onDidChangeFileDecorations = new vscode.EventEmitter<vscode.Uri | vscode.Uri[] | undefined>();
  readonly onDidChangeFileDecorations = this._onDidChangeFileDecorations.event;
  private readonly statusWatch: Disposable;
  private readonly codec = new SessionUriCodec();
  private statuses: Map<string, AgentStatus>;

  constructor(
    private readonly store: AgentStatusStoreLike,
    private readonly rollups: AgentStatusDecorationRollups,
  ) {
    this.statuses = this.syncStatuses();
    this.statusWatch = this.store.onDidChange((change) => {
      const previous = this.statuses;
      this.statuses = this.syncStatuses();
      const decoratedSessionNames = change.sessionNames.filter((sessionName) =>
        hasDecoration(previous.get(sessionName)) || hasDecoration(this.statuses.get(sessionName))
      );
      this.fire(this.rollups.invalidationUrisForSessions(decoratedSessionNames));
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

  fire(uris: readonly AgentStatusDecorationResourceUri[]): void {
    if (uris.length === 0) return;
    this._onDidChangeFileDecorations.fire(uris.map((uri) => vscode.Uri.from(uri)));
  }

  dispose(): void {
    this.statusWatch.dispose();
    this._onDidChangeFileDecorations.dispose();
  }

  private syncStatuses(): Map<string, AgentStatus> {
    const statuses = new Map(this.store.entries());
    this.rollups.setStatuses(statuses);
    return statuses;
  }
}

function hasDecoration(status: AgentStatus | undefined): boolean {
  return provideAgentStatusDecoration(agentStatusDecorationUri('status-check'), status) !== undefined;
}
