import { ExecFileCommandRunner, type CommandRunner } from './tmuxCli';

export interface TmuxPreflightResult {
  available: boolean;
  reason?: string;
  binaryPath?: string;
}

// VS Code's extension host on macOS GUI launch frequently inherits a stripped
// PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) that doesn't include Homebrew. We try
// the bare name first so a working PATH is preferred, then fall through to the
// canonical install locations.
export const DEFAULT_TMUX_BINARY_CANDIDATES: readonly string[] = [
  'tmux',
  '/opt/homebrew/bin/tmux',
  '/usr/local/bin/tmux',
  '/usr/bin/tmux',
];

export async function tmuxPreflight(
  runner: CommandRunner = new ExecFileCommandRunner(),
  candidates: readonly string[] = DEFAULT_TMUX_BINARY_CANDIDATES,
): Promise<TmuxPreflightResult> {
  let lastReason: string | undefined;

  for (const candidate of candidates) {
    let stdout: string;
    try {
      const result = await runner.run(candidate, ['-V']);
      if (result.code !== 0) {
        lastReason = result.stderr || result.stdout || 'tmux not found';
        continue;
      }
      stdout = result.stdout.trim();
    } catch {
      lastReason = 'tmux not found';
      continue;
    }

    const match = stdout.match(/(\d+)\.(\d+)/);
    if (!match) return { available: false, reason: `${stdout} is not a supported tmux version` };

    const major = Number(match[1]);
    const minor = Number(match[2]);
    if (major > 3 || (major === 3 && minor >= 1)) {
      return { available: true, binaryPath: candidate };
    }
    return { available: false, reason: `${stdout} is older than 3.1` };
  }

  return { available: false, reason: lastReason ?? 'tmux not found' };
}
