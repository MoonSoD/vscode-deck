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

  async ensureSessionWindow(session: string, windowName: string, cwd: string): Promise<void> {
    if (await this.hasSession(session)) return;

    const result = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'new-session',
      '-d',
      '-s',
      session,
      '-n',
      windowName,
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

  async listSessions(): Promise<TmuxSession[]> {
    const result = await this.runner.run('tmux', [
      ...this.baseArgs(),
      'list-sessions',
      '-F',
      '#{session_name}\t#{window_name}',
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
      });
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
  const output = `${result.stdout}\n${result.stderr}`;
  return output.includes('session not found') || output.includes('no server running');
}
