import { execFile } from 'node:child_process';

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
    private readonly binaryPath: string = 'tmux',
  ) {}

  async version(): Promise<string> {
    const result = await this.runner.run(this.binaryPath, ['-V']);
    if (result.code !== 0) throw new Error(result.stderr || 'tmux -V failed');
    return result.stdout.trim();
  }

  async hasSession(session: string): Promise<boolean> {
    const result = await this.runner.run(this.binaryPath, [
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
    const result = await this.runner.run(this.binaryPath, [
      ...this.baseArgs(),
      'new-session',
      '-d',
      '-s',
      session,
      '-c',
      cwd,
    ]);
    if (result.code === 0) return;
    if (isDuplicateSession(result) && (await this.hasSession(session))) return;

    throw new Error(result.stderr || result.stdout || `tmux new-session failed: ${result.code}`);
  }

  async killSession(session: string): Promise<void> {
    const result = await this.runner.run(this.binaryPath, [
      ...this.baseArgs(),
      'kill-session',
      '-t',
      exactTarget(session),
    ]);
    if (result.code === 0 || isMissingSession(result)) return;
    throw new Error(result.stderr || result.stdout || `tmux kill-session failed: ${result.code}`);
  }

  async listSessions(prefix?: string): Promise<TmuxSession[]> {
    // Use `#{pane_current_command}` rather than `#{window_name}` — tmux reads
    // the former fresh from the OS (tcgetpgrp + process table) on every query,
    // so it always reflects the actual foreground process. window_name relies
    // on automatic-rename being enabled, which a stray shell-emitted OSC
    // sequence (or other quirk) can silently disable for a window.
    const result = await this.runner.run(this.binaryPath, [
      ...this.baseArgs(),
      'list-sessions',
      '-F',
      '#{session_name}\t#{pane_current_command}',
    ]);
    if (result.code !== 0 && isMissingSession(result)) return [];
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

  attachShellArgs(session: string): string[] {
    return [...this.baseArgs(), 'attach-session', '-t', exactTarget(session)];
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
  // Three shapes from tmux when the -L deck world is empty:
  //   "session not found"  — server up, target absent
  //   "no server running"  — server stopped but socket file lingered
  //   "error connecting to …" — socket file itself absent (fresh boot, never new-session'd)
  const output = `${result.stdout}\n${result.stderr}`;
  return (
    output.includes('session not found') ||
    output.includes('no server running') ||
    output.includes('error connecting')
  );
}
