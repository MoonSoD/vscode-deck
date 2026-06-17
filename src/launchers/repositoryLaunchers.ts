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
      repository: entry.repository.trim(),
      launchers: parseTerminalLaunchers(entry.launchers),
    }];
  });
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
