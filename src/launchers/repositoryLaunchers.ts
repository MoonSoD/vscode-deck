import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseTerminalLaunchers, type TerminalLauncher } from './terminalLaunchers';

export interface RepositoryLaunchers {
  repository: string;
  launchers: TerminalLauncher[];
}

export function parseRepositoryLaunchers(raw: unknown): RepositoryLaunchers[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    if (typeof entry.repository !== 'string' || entry.repository.trim() === '') return [];
    if (!Array.isArray(entry.launchers)) return [];

    return [{
      repository: expandTilde(entry.repository.trim()),
      launchers: parseTerminalLaunchers(entry.launchers),
    }];
  });
}

// The repository path is hand-typed in user settings, where a leading `~` is
// natural — but it reaches git as a `cwd`, which is never shell-expanded, so an
// unexpanded `~` would silently never match. Expand it so the stored path is
// absolute.
function expandTilde(repositoryPath: string): string {
  if (repositoryPath === '~') return homedir();
  if (repositoryPath.startsWith('~/')) return join(homedir(), repositoryPath.slice(2));
  return repositoryPath;
}

export async function selectRepositoryLaunchersFor(
  worktreePath: string,
  entries: RepositoryLaunchers[],
  resolveCommonDir: (repositoryPath: string) => Promise<string | null>,
): Promise<TerminalLauncher[]> {
  const worktreeCommonDir = await resolveCommonDir(worktreePath);
  if (worktreeCommonDir === null) return [];

  for (const entry of entries) {
    const entryCommonDir = await resolveCommonDir(entry.repository);
    if (entryCommonDir === worktreeCommonDir) return entry.launchers;
  }

  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
