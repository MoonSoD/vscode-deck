import * as path from 'node:path';
import * as vscode from 'vscode';
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

export class EditorTerminalHydrator {
  constructor(
    private readonly tmux: HydratorTmuxCli,
    private readonly registry: TerminalSessionRegistry,
    private readonly pidStore: TerminalPidStoreLike,
  ) {}

  async hydrateOne(terminal: HydratableTerminal): Promise<void> {
    const liveSessions = await this.getLiveSessionNamesFor(terminal);
    if (!liveSessions) return;
    await this.hydrateTerminal(terminal, liveSessions);
  }

  async hydrateSnapshot(terminals: readonly HydratableTerminal[]): Promise<void> {
    const liveSessionNames = (await this.tmux.listSessions()).map((session) => session.sessionName);
    const liveSessions = new Set(liveSessionNames);
    for (const terminal of terminals) {
      await this.hydrateTerminal(terminal, liveSessions);
    }
    await this.pidStore.prune(liveSessionNames);
  }

  private async getLiveSessionNamesFor(terminal: HydratableTerminal): Promise<Set<string> | undefined> {
    if (!this.sessionNameFor(terminal)) return undefined;
    return new Set((await this.tmux.listSessions()).map((session) => session.sessionName));
  }

  private async hydrateTerminal(
    terminal: HydratableTerminal,
    liveSessions: ReadonlySet<string>,
  ): Promise<void> {
    const sessionName = this.sessionNameFor(terminal);
    if (!sessionName) return;

    if (!liveSessions.has(sessionName)) {
      await this.pidStore.remove(sessionName);
      terminal.dispose?.();
      return;
    }

    const pid = await terminal.processId;
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

    const cwd = terminalCwd(terminal);
    const currentWorktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!cwd || !currentWorktreePath) return undefined;
    if (path.resolve(cwd) !== path.resolve(currentWorktreePath)) return undefined;

    return terminalSessionName(cwd, n);
  }

  private async recreateTerminal(
    terminal: HydratableTerminal,
    sessionName: string,
  ): Promise<void> {
    const viewColumn = terminalViewColumn(terminal);
    const options: vscode.TerminalOptions = {
      name: terminal.name,
      shellPath: 'tmux',
      shellArgs: this.tmux.attachShellArgs(sessionName),
      ...(viewColumn === undefined ? {} : { location: { viewColumn } }),
    };
    const recreated = vscode.window.createTerminal(options) as HydratableTerminal;
    terminal.dispose?.();
    this.registry.set(sessionName, recreated);
    const pid = await recreated.processId;
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

function terminalCwd(terminal: vscode.Terminal): string | undefined {
  if (!('cwd' in terminal.creationOptions)) return undefined;
  const cwd = terminal.creationOptions.cwd;
  if (!cwd) return undefined;
  if (typeof cwd === 'string') return cwd;
  return cwd.fsPath;
}

function terminalViewColumn(terminal: vscode.Terminal): vscode.ViewColumn | undefined {
  for (const group of vscode.window.tabGroups?.all ?? []) {
    if (
      group.tabs.some((tab) => {
        if (!(tab.input instanceof vscode.TabInputTerminal)) return false;
        return (tab.input as { terminal?: vscode.Terminal }).terminal === terminal;
      })
    ) {
      return group.viewColumn;
    }
  }
  return undefined;
}
