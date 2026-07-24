import { spawn } from 'node:child_process';

// A hand-written structural subset of ChildProcess (mirrors TmuxControlChild) so
// tests can supply a fake without a real process.
export interface ChromeProcess {
  pid?: number;
  unref(): void;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

export type ChromeSpawnFactory = (
  file: string,
  args: string[],
  options: { detached: boolean; stdio: 'ignore' },
) => ChromeProcess;

const defaultSpawn: ChromeSpawnFactory = (file, args, options) =>
  spawn(file, args, options) as ChromeProcess;

export interface ChromeLaunchOptions {
  url: string;
  userDataDir: string;
  debugPort: number;
  extraArgs?: string[];
}

// Launches real Google Chrome windows for PreviewWindows. Each Worktree gets one
// isolated instance (its `--user-data-dir` + `--remote-debugging-port`); each
// named preview is a `--app` window. When an instance for the profile already
// runs, Chrome routes a second launch into it as a new window and the repeated
// `--remote-debugging-port` is ignored — so `launch` is uniform for first and
// subsequent windows. argv array, no shell (ADR-0012 security posture); the
// process is detached and unref'd so it outlives the extension host, and its pid
// is returned so the PreviewCascade can tear the instance down.
export class ChromeLauncher {
  constructor(
    private readonly binaryPath: string,
    private readonly spawnFactory: ChromeSpawnFactory = defaultSpawn,
  ) {}

  launch(options: ChromeLaunchOptions): { pid?: number } {
    const child = this.spawnFactory(this.binaryPath, this.launchArgs(options), {
      detached: true,
      stdio: 'ignore',
    });
    // A spawn failure (e.g. wrong chromePath) must not crash the host; it surfaces
    // as the instance never becoming reachable over CDP, handled by the caller.
    child.on('error', () => undefined);
    child.unref();
    return { pid: child.pid };
  }

  // Bring Chrome to the foreground on macOS. Activating a CDP target raises the
  // window within Chrome, but not Chrome above other apps — this does that.
  raiseApp(): void {
    const child = this.spawnFactory('open', ['-b', 'com.google.Chrome'], {
      detached: true,
      stdio: 'ignore',
    });
    child.on('error', () => undefined);
    child.unref();
  }

  private launchArgs(options: ChromeLaunchOptions): string[] {
    return [
      `--app=${options.url}`,
      `--user-data-dir=${options.userDataDir}`,
      `--remote-debugging-port=${options.debugPort}`,
      '--no-first-run',
      '--no-default-browser-check',
      ...(options.extraArgs ?? []),
    ];
  }
}
