import * as vscode from 'vscode';

export interface TerminalLike {
  show(preserveFocus?: boolean): void;
  dispose?(): void;
  // VS Code unions TerminalOptions and ExtensionTerminalOptions here; only
  // the former carries shellArgs. Use `unknown` to accept the union without
  // forcing every test fake to satisfy the full vscode types.
  readonly creationOptions?: unknown;
}

export class TerminalSessionRegistry {
  private readonly terminals = new Map<string, TerminalLike>();

  get(session: string): TerminalLike | undefined {
    return this.getTerminal(session);
  }

  getTerminal(session: string): TerminalLike | undefined {
    return this.terminals.get(session);
  }

  set(session: string, terminal: TerminalLike): void {
    this.terminals.set(session, terminal);
  }

  // VS Code restores editor terminals across reloads by re-running their
  // creation options. Those restored Terminals never enter our registry
  // through the usual path (we only `set` after our own `createTerminal`
  // calls). Scan the current window's terminals on activate so we recognize
  // them and don't open duplicates pointing at the same tmux session.
  hydrateFromWindow(terminals: readonly TerminalLike[]): void {
    for (const terminal of terminals) {
      const session = extractDeckSession(terminal);
      if (!session) continue;
      if (this.terminals.has(session)) continue;
      this.terminals.set(session, terminal);
    }
  }

  findByCreationOptions(terminals: readonly TerminalLike[], session: string): TerminalLike | undefined {
    for (const terminal of terminals) {
      if (extractDeckSession(terminal) === session) return terminal;
    }
    return undefined;
  }

  deleteSession(session: string): void {
    this.terminals.delete(session);
  }

  findSession(terminal: TerminalLike): string | undefined {
    for (const [session, registered] of this.terminals) {
      if (registered === terminal) return session;
    }
    return undefined;
  }

  async renameIfActive(session: string, name: string): Promise<void> {
    const terminal = this.terminals.get(session);
    if (!terminal) return;
    if (vscode.window.activeTerminal !== (terminal as unknown as vscode.Terminal)) return;
    try {
      await vscode.commands.executeCommand('workbench.action.terminal.renameWithArg', { name });
    } catch {
      // Internal VS Code command — cosmetic, swallow if it ever disappears.
    }
  }

  dispose(): void {
    // Registered as a VS Code subscription; no external resources to release.
  }
}

// Deck always attaches via `tmux ... attach-session -t =<sessionName>`.
// Reverse-engineer the sessionName from creationOptions.shellArgs.
function extractDeckSession(terminal: TerminalLike): string | undefined {
  const opts = terminal.creationOptions as { shellArgs?: readonly string[] | string } | undefined;
  const args = opts?.shellArgs;
  if (!args || typeof args === 'string') return undefined;
  const idx = args.indexOf('attach-session');
  if (idx === -1) return undefined;
  const target = args[idx + 2];
  if (typeof target !== 'string' || !target.startsWith('=wt-')) return undefined;
  return target.slice(1);
}
