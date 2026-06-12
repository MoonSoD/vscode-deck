import { stat } from 'node:fs/promises';
import { join } from 'node:path';

export interface TerminalSnapshotRestoreProgressContext {
  unresponsive: boolean;
}

export interface TerminalSnapshotRestoreFeedback {
  withProgress(context: TerminalSnapshotRestoreProgressContext, task: () => Promise<void>): Promise<void>;
}

export interface TerminalSnapshotRestoreProgressCopy {
  title: string;
  message: string;
}

export function formatTerminalSnapshotRestoreProgress(options: {
  unresponsive: boolean;
  lastSavedAt?: Date;
}): TerminalSnapshotRestoreProgressCopy {
  return {
    title: options.unresponsive
      ? "Deck's terminal server is unresponsive. Restarting…"
      : "Restoring Deck's terminals…",
    message: options.lastSavedAt
      ? `Restoring terminals from ${formatLastSavedAt(options.lastSavedAt)}.`
      : 'Restoring terminals…',
  };
}

export async function terminalSnapshotLastSaveTime(
  deckDir: string,
  fs: { stat(path: string): Promise<{ mtime: Date }> } = { stat },
): Promise<Date | undefined> {
  try {
    return (await fs.stat(join(deckDir, 'resurrect', 'last'))).mtime;
  } catch (error) {
    if (error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
}

function formatLastSavedAt(lastSavedAt: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
  }).format(lastSavedAt);
}
