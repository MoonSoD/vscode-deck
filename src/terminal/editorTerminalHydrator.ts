import * as vscode from 'vscode';
import { awaitProcessId } from './awaitProcessId';
import { terminalSessionName } from './tmuxSafe';
import type { TerminalLike, TerminalSessionRegistry } from './terminalSessionRegistry';
import type { TmuxSession } from './tmuxCli';

interface HydratorTmuxCli {
  listSessions(prefix?: string): Promise<TmuxSession[]>;
  attachShellArgs(session: string): string[];
}

interface TerminalPidStoreLike {
  get(sessionName: string): number | undefined;
  set(sessionName: string, pid: number): Promise<void>;
  remove(sessionName: string): Promise<void>;
  prune(liveSessionNames: readonly string[]): Promise<void>;
}

type HydratableTerminal = vscode.Terminal & TerminalLike;

export interface TabPosition {
  viewColumn: vscode.ViewColumn;
  tabIndex: number;
  groupSize: number;
}

export class EditorTerminalHydrator {
  constructor(
    private readonly tmux: HydratorTmuxCli,
    private readonly registry: TerminalSessionRegistry,
    private readonly pidStore: TerminalPidStoreLike,
  ) {}

  async hydrateOne(terminal: HydratableTerminal): Promise<void> {
    const sessionName = this.sessionNameFor(terminal);
    if (!sessionName) return;
    await this.hydrateTerminal(terminal, sessionName, await this.liveSessionNames());
  }

  async hydrateSnapshot(terminals: readonly HydratableTerminal[]): Promise<void> {
    const liveSessionNames = (await this.tmux.listSessions()).map((session) => session.sessionName);
    const liveSessions = new Set(liveSessionNames);
    for (const terminal of terminals) {
      const sessionName = this.sessionNameFor(terminal);
      if (!sessionName) continue;
      await this.hydrateTerminal(terminal, sessionName, liveSessions);
    }
    await this.pidStore.prune(liveSessionNames);
  }

  private async liveSessionNames(): Promise<Set<string>> {
    return new Set((await this.tmux.listSessions()).map((session) => session.sessionName));
  }

  private async hydrateTerminal(
    terminal: HydratableTerminal,
    sessionName: string,
    liveSessions: ReadonlySet<string>,
  ): Promise<void> {
    if (!liveSessions.has(sessionName)) {
      await this.pidStore.remove(sessionName);
      terminal.dispose?.();
      return;
    }

    const pid = await awaitProcessId(terminal);
    const storedPid = this.pidStore.get(sessionName);
    const existing = this.registry.getTerminal(sessionName);
    const pidMatches = storedPid !== undefined && pid === storedPid;

    if (existing && existing !== terminal) {
      if (pidMatches) {
        existing.dispose?.();
        this.registry.set(sessionName, terminal);
      } else {
        terminal.dispose?.();
      }
      return;
    }

    if (pidMatches) {
      this.registry.set(sessionName, terminal);
      return;
    }

    await this.recreateTerminal(terminal, sessionName);
  }

  private sessionNameFor(terminal: vscode.Terminal): string | undefined {
    const n = parseDeckTerminalNumber(terminal.name);
    if (!n) return undefined;
    // We can't cross-check the terminal's own cwd: VS Code's restoration
    // pipeline drops creationOptions.cwd by design. mainThreadTerminalService
    // builds the DTO from shellLaunchConfig.cwd, which is intentionally
    // undefined on restored terminals (the live cwd lives on
    // attachPersistentProcess.cwd / instance._cwd internally but never
    // surfaces through the stable Terminal API). So identification falls back
    // to "name pattern + current workspace folder". A user who manually
    // names a non-Deck terminal `N word` in this worktree would false-match;
    // accepted given the default-profile-named "tmux" panel terminals don't
    // collide with our `^\d+ \S+` shape.
    const currentWorktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!currentWorktreePath) return undefined;
    return terminalSessionName(currentWorktreePath, n);
  }

  private async recreateTerminal(
    terminal: HydratableTerminal,
    sessionName: string,
  ): Promise<void> {
    const originalPos = findTabPosition(terminal);
    if (originalPos === undefined) {
      // No editor strip slot found (the tab isn't in tabGroups.all yet —
      // common during activate when restoration hasn't fully wired tabs to
      // groups, or the tab is genuinely panel-located). Dispose first; the
      // "only tab in column" footgun doesn't apply when there's no column.
      terminal.dispose?.();
    }
    // Always target the editor area. Omitting `location` would make VS Code
    // honor `terminal.integrated.defaultLocation` ("view" by default = panel),
    // which silently relocates the recreated terminal out of the editor strip
    // — the bug that surfaced as "after cross-worktree click, my tabs ended
    // up in the panel".
    const location: vscode.TerminalEditorLocationOptions = {
      viewColumn: originalPos?.viewColumn ?? vscode.ViewColumn.Active,
    };
    const options: vscode.TerminalOptions = {
      name: terminal.name,
      shellPath: 'tmux',
      shellArgs: this.tmux.attachShellArgs(sessionName),
      location,
    };
    const recreated = vscode.window.createTerminal(options) as HydratableTerminal;
    if (originalPos !== undefined) {
      recreated.show(false);
      await moveActiveEditorLeft(originalPos.groupSize - originalPos.tabIndex - 1);
      terminal.dispose?.();
    }
    this.registry.set(sessionName, recreated);
    const pid = await awaitProcessId(recreated);
    if (pid !== undefined) {
      await this.pidStore.set(sessionName, pid);
    }
  }
}

function parseDeckTerminalNumber(name: string): number | undefined {
  const match = /^(\d+)\s+\S+/.exec(name);
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isInteger(n) ? n : undefined;
}

export function findTabPosition(terminal: vscode.Terminal): TabPosition | undefined {
  for (const group of vscode.window.tabGroups?.all ?? []) {
    const tabIndex = group.tabs.findIndex((tab) => {
      if (!(tab.input instanceof vscode.TabInputTerminal)) return false;
      return (tab.input as { terminal?: vscode.Terminal }).terminal === terminal;
    });
    if (tabIndex !== -1) {
      return { viewColumn: group.viewColumn, tabIndex, groupSize: group.tabs.length };
    }
  }
  return undefined;
}

export async function moveActiveEditorLeft(times: number): Promise<void> {
  for (let i = 0; i < times; i += 1) {
    try {
      await vscode.commands.executeCommand('workbench.action.moveEditorLeftInGroup');
    } catch {
      // Best-effort tab strip repair; attachment correctness does not depend on it.
    }
  }
}
