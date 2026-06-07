import * as vscode from 'vscode';
import { terminalSessionName } from './tmuxSafe';
import type { TerminalLike, TerminalSessionRegistry } from './terminalSessionRegistry';
import type { TmuxSession } from './tmuxCli';

interface HydratorTmuxCli {
  listSessions(prefix?: string): Promise<TmuxSession[]>;
}

type HydratableTerminal = vscode.Terminal & TerminalLike;

// VS Code's terminal persistence preserves a Deck tab's pty across "Reload
// Window" (attachPersistentProcess) and re-launches its original
// shellPath/shellArgs across workspace switch + Cmd+Q (saved editor state).
// In every case the restored tab is correctly attached to its Deck tmux
// session (or to a session-not-found error if the tmux server died — handled
// here via the listSessions check). So hydration's only job is:
//
//   1. Identify each restored tab by its Deck-shaped name + current workspace
//      folder.
//   2. If the corresponding tmux session exists, put the tab into our
//      in-memory registry so subsequent sidebar clicks reuse it.
//   3. If the session is gone, dispose the orphan tab.
//
// Earlier versions kept a per-tab PID store to detect "wrong attachment"
// scenarios (where VS Code restored a Deck tab attached to the user's
// default tmux server instead of -L deck). The check was over-zealous: it
// forced dispose+recreate on every workspace switch and full restart, since
// VS Code only preserves the original pty across RELOAD — workspace switch
// (LOAD) and Cmd+Q (QUIT) re-launch with new PIDs even when the tab is still
// correctly Deck-attached. The PID check made hydration lose xterm
// scrollback on every switch. Dropped.
export class EditorTerminalHydrator {
  constructor(
    private readonly tmux: HydratorTmuxCli,
    private readonly registry: TerminalSessionRegistry,
  ) {}

  async hydrateOne(terminal: HydratableTerminal): Promise<void> {
    const sessionName = this.sessionNameFor(terminal);
    if (!sessionName) return;
    await this.hydrateTerminal(terminal, sessionName, await this.liveSessionNames());
  }

  async hydrateSnapshot(terminals: readonly HydratableTerminal[]): Promise<void> {
    const liveSessions = await this.liveSessionNames();
    for (const terminal of terminals) {
      const sessionName = this.sessionNameFor(terminal);
      if (!sessionName) continue;
      await this.hydrateTerminal(terminal, sessionName, liveSessions);
    }
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
      terminal.dispose?.();
      return;
    }

    const existing = this.registry.getTerminal(sessionName);
    if (existing && existing !== terminal) {
      // Two terminals claim the same Deck session — e.g. an out-of-band
      // duplicate from a prior buggy build, or a race between the activate
      // snapshot pass and the onDidOpenTerminal subscription registering
      // the same restored tab twice. Keep the first; dispose the later
      // arrival so it can't accumulate.
      terminal.dispose?.();
      return;
    }

    this.registry.set(sessionName, terminal);
  }

  private sessionNameFor(terminal: vscode.Terminal): string | undefined {
    const n = parseDeckTerminalNumber(terminal.name);
    if (!n) return undefined;
    // VS Code drops creationOptions.cwd on restored terminals
    // (terminalInstance.ts:549 only fills executable/args from the default
    // profile on restore; cwd never makes it back to shellLaunchConfig.cwd,
    // so the ext-host DTO at mainThreadTerminalService.ts:_onTerminalOpened
    // reports cwd=undefined). Identify by name pattern + current workspace
    // folder alone. False positives require a user to manually name a
    // non-Deck terminal `N word` in this worktree — accepted.
    const currentWorktreePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!currentWorktreePath) return undefined;
    return terminalSessionName(currentWorktreePath, n);
  }
}

function parseDeckTerminalNumber(name: string): number | undefined {
  const match = /^(\d+)\s+\S+/.exec(name);
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isInteger(n) ? n : undefined;
}
