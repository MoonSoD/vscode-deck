import * as vscode from 'vscode';
import type { MementoLike } from '../switch/activeWorktreeStore';
import { SessionUriCodec } from './sessionUriCodec';
import { terminalEditorViewType } from './terminalEditorProvider';
import { terminalSessionPrefix } from './tmuxSafe';

export const TERMINAL_SNAPSHOT_KEY = 'deck.terminalSnapshot';
export const TERMINAL_SNAPSHOT_SCHEMA_VERSION = 1;

type MaybePromise<T> = T | PromiseLike<T>;

export interface WorktreeTerminalSnapshot {
  schemaVersion: 1;
  layout: unknown;
  tabs: WorktreeTerminalSnapshotTab[];
}

export interface WorktreeTerminalSnapshotTab {
  sessionName: string;
  viewColumn: vscode.ViewColumn;
  index: number;
  pinned: boolean;
  active: boolean;
}

export class TabSnapshotStore {
  constructor(
    private readonly memento: MementoLike,
    private readonly sessionUriCodec: SessionUriCodec = new SessionUriCodec(),
  ) {}

  async capture(): Promise<void> {
    const worktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!worktreePath) return;

    const prefix = terminalSessionPrefix(worktreePath);
    const layout = await vscode.commands.executeCommand('vscode.getEditorLayout');
    const tabs: WorktreeTerminalSnapshotTab[] = [];

    for (const group of vscode.window.tabGroups.all) {
      group.tabs.forEach((tab, index) => {
        const sessionName = this.sessionForTab(tab);
        if (!sessionName?.startsWith(prefix)) return;
        tabs.push({
          sessionName,
          viewColumn: group.viewColumn,
          index,
          pinned: tab.isPinned,
          active: tab.isActive,
        });
      });
    }

    await this.write({ schemaVersion: TERMINAL_SNAPSHOT_SCHEMA_VERSION, layout, tabs });
  }

  async restore(): Promise<void> {
    const worktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!worktreePath) return;

    const snapshot = await this.read();
    if (snapshot.tabs.length === 0) return;

    await vscode.commands.executeCommand('vscode.setEditorLayout', snapshot.layout);

    const tabs = [...snapshot.tabs].sort(
      (left, right) => left.viewColumn - right.viewColumn || left.index - right.index,
    );
    for (const tab of tabs) {
      await this.openTab(tab, worktreePath, !tab.active);
    }

    for (const tab of tabs.filter((candidate) => candidate.pinned)) {
      await this.openTab(tab, worktreePath, false);
      await vscode.commands.executeCommand('workbench.action.pinEditor');
    }

    for (const tab of tabs.filter((candidate) => candidate.active)) {
      await this.openTab(tab, worktreePath, false);
    }
  }

  private sessionForTab(tab: vscode.Tab): string | undefined {
    const input = tab.input as { viewType?: unknown; uri?: vscode.Uri };
    if (input.viewType !== terminalEditorViewType || !input.uri) return undefined;

    try {
      return this.sessionUriCodec.decode(input.uri).sessionName;
    } catch {
      return undefined;
    }
  }

  private async write(snapshot: WorktreeTerminalSnapshot): Promise<void> {
    await (this.memento.update(TERMINAL_SNAPSHOT_KEY, snapshot) as MaybePromise<void>);
  }

  private async read(): Promise<WorktreeTerminalSnapshot> {
    const raw = this.memento.get<WorktreeTerminalSnapshot | undefined>(
      TERMINAL_SNAPSHOT_KEY,
      undefined,
    );
    if (raw?.schemaVersion === TERMINAL_SNAPSHOT_SCHEMA_VERSION) return raw;

    const empty = {
      schemaVersion: TERMINAL_SNAPSHOT_SCHEMA_VERSION,
      layout: undefined,
      tabs: [],
    } satisfies WorktreeTerminalSnapshot;
    if (raw !== undefined) await this.write(empty);
    return empty;
  }

  private async openTab(
    tab: WorktreeTerminalSnapshotTab,
    cwd: string,
    preserveFocus: boolean,
  ): Promise<void> {
    await vscode.commands.executeCommand(
      'vscode.openWith',
      this.sessionUriCodec.encode({ sessionName: tab.sessionName, cwd }),
      terminalEditorViewType,
      { viewColumn: tab.viewColumn, preserveFocus },
    );
  }
}
