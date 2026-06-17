export interface TerminalLauncher {
  label: string;
  command: string;
  runOnWorktreeCreate?: boolean;
}

export function parseTerminalLaunchers(raw: unknown): TerminalLauncher[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    if (typeof entry.command !== 'string' || entry.command.trim() === '') return [];

    const label = typeof entry.label === 'string' && entry.label.trim() !== ''
      ? entry.label.trim()
      : entry.command;

    return [{
      label,
      command: entry.command,
      ...(entry.runOnWorktreeCreate === true ? { runOnWorktreeCreate: true } : {}),
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
