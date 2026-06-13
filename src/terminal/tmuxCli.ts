import { execFile } from 'node:child_process';
import { isWedged } from './deckSocketRecovery';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface CommandRunner {
  run(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult>;
}

export interface TmuxSession {
  sessionName: string;
  windowName: string;
}

export class ExecFileCommandRunner implements CommandRunner {
  run(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      execFile(command, args, { cwd: options?.cwd }, (error, stdout, stderr) => {
        if (!error) {
          resolve({ code: 0, stdout, stderr });
          return;
        }

        const code = typeof error.code === 'number' ? error.code : undefined;
        if (code === undefined) {
          reject(error);
          return;
        }

        resolve({ code, stdout, stderr });
      });
    });
  }
}

export class TmuxCli {
  constructor(
    private readonly configPath: string,
    private readonly runner: CommandRunner = new ExecFileCommandRunner(),
  ) {}

  async version(): Promise<string> {
    const result = await this.runner.run('tmux', ['-V']);
    if (result.code !== 0) throw new Error(result.stderr || 'tmux -V failed');
    return result.stdout.trim();
  }

  async hasSession(session: string): Promise<boolean> {
    const result = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'has-session',
      '-t',
      exactTarget(session),
    ]);
    return result.code === 0;
  }

  async ensureSession(session: string, cwd: string): Promise<void> {
    if (await this.hasSession(session)) return;

    // Deliberately omit `-n`: passing it marks the window as "manually named"
    // and disables tmux's automatic-rename for that window — `zsh` would
    // never update to `claude`. Default naming lets automatic-rename do its
    // job. Sanctel's phantom-window bug (which needed `-n`) doesn't apply
    // here because Deck's model is one-window-per-session forever.
    const result = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'new-session',
      '-d',
      '-s',
      session,
      '-e',
      `DECK_SESSION=${session}`,
      '-c',
      cwd,
    ]);
    if (result.code === 0) return;
    if (isDuplicateSession(result) && (await this.hasSession(session))) return;

    throw new Error(result.stderr || result.stdout || `tmux new-session failed: ${result.code}`);
  }

  async killSession(session: string): Promise<void> {
    const result = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'kill-session',
      '-t',
      exactTarget(session),
    ]);
    if (result.code === 0 || isMissingSession(result)) return;
    throw new Error(result.stderr || result.stdout || `tmux kill-session failed: ${result.code}`);
  }

  async listSessions(prefix?: string): Promise<TmuxSession[]> {
    // Read `#{window_name}` so the sidebar row and the editor tab share tmux's
    // canonical name. deck.conf keeps `automatic-rename on`, so it tracks the
    // foreground command (zsh -> claude); a manual `rename-window` then sticks.
    const result = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'list-sessions',
      '-F',
      '#{session_name}\t#{window_name}',
    ]);
    if (result.code !== 0 && (isMissingSession(result) || isWedged(result))) return [];
    if (result.code !== 0) {
      throw new Error(result.stderr || result.stdout || `tmux list-sessions failed: ${result.code}`);
    }

    return result.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [sessionName, windowName = ''] = line.split('\t');
        return { sessionName, windowName };
      })
      .filter((session) => prefix === undefined || session.sessionName.startsWith(prefix));
  }

  async windowName(session: string): Promise<string | undefined> {
    // No `=` exact-target prefix here: display-message resolves `-t` as a
    // target-pane, where `=name` yields an empty result. The session name is
    // complete and unique, so a bare target matches it exactly.
    const result = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'display-message',
      '-p',
      '-t',
      session,
      '#{window_name}',
    ]);
    if (result.code !== 0) return undefined;
    return result.stdout.trim() || undefined;
  }

  async serverStartTime(): Promise<string | undefined> {
    const pidResult = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'display-message',
      '-p',
      '#{pid}',
    ]);
    if (pidResult.code !== 0) return undefined;

    const pid = pidResult.stdout.trim();
    if (!/^\d+$/.test(pid)) return undefined;

    const startTimeResult = await this.runner.run('ps', ['-o', 'lstart=', '-p', pid]);
    if (startTimeResult.code !== 0) return undefined;

    return startTimeResult.stdout.trim().replace(/\s+/g, ' ') || undefined;
  }

  attachShellArgs(session: string): string[] {
    return [...this.baseArgs(), 'attach-session', '-t', exactTarget(session)];
  }

  async runShell(scriptPath: string): Promise<void> {
    const result = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'run-shell',
      scriptPath,
    ]);
    if (result.code === 0) return;
    throw new Error(result.stderr || result.stdout || `tmux run-shell failed: ${result.code}`);
  }

  async newAnchorSession(session: string, cwd: string): Promise<void> {
    const result = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'new-session',
      '-d',
      '-s',
      session,
      '-c',
      cwd,
    ]);
    if (result.code === 0) return;
    throw new Error(result.stderr || result.stdout || `tmux new-session failed: ${result.code}`);
  }

  async setOption(name: string, value: string): Promise<void> {
    const result = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'set',
      '-g',
      name,
      value,
    ]);
    if (result.code === 0) return;
    throw new Error(result.stderr || result.stdout || `tmux set failed: ${result.code}`);
  }

  async unsetOption(name: string): Promise<void> {
    const result = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'set',
      '-gu',
      name,
    ]);
    if (result.code === 0) return;
    throw new Error(result.stderr || result.stdout || `tmux set -gu failed: ${result.code}`);
  }

  async restoreAutomaticRename(session: string): Promise<void> {
    const result = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'set',
      '-w',
      '-t',
      exactTarget(session),
      'automatic-rename',
      'on',
    ]);
    if (result.code === 0 || isMissingSession(result)) return;
    throw new Error(result.stderr || result.stdout || `tmux set -w failed: ${result.code}`);
  }

  async isServerRunning(): Promise<boolean> {
    const result = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'has-session',
    ]);
    return result.code === 0;
  }

  private baseArgs(): string[] {
    return ['-L', 'deck', '-f', this.configPath];
  }
}

function exactTarget(session: string): string {
  return `=${session}`;
}

function isDuplicateSession(result: CommandResult): boolean {
  return `${result.stdout}\n${result.stderr}`.includes('duplicate session');
}

function isMissingSession(result: CommandResult): boolean {
  // Shapes from tmux when the target session is gone:
  //   "can't find session: <name>" — kill-session/most -t commands, target absent
  //   "session not found"  — server up, target absent (some commands)
  //   "no server running"  — server stopped but socket file lingered
  //   "error connecting to …" — socket file itself absent (fresh boot, never new-session'd)
  // The "can't find session" shape is the one kill-session emits when a tab is
  // closed after its shell already exited — missing it made killSession throw
  // and abort the tab-dispose cleanup, leaving a stale sidebar row.
  const output = `${result.stdout}\n${result.stderr}`;
  return (
    output.includes("can't find session") ||
    output.includes('session not found') ||
    output.includes('no server running') ||
    output.includes('error connecting')
  );
}
