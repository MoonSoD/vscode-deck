import { describe, expect, it } from 'vitest';
import {
  formatTerminalSnapshotRestoreProgress,
  terminalSnapshotLastSaveTime,
} from '../src/terminal/terminalSnapshotRestoreFeedback';

describe('formatTerminalSnapshotRestoreProgress', () => {
  it('frames wedged recovery as unresponsive and includes the last-save time', () => {
    expect(formatTerminalSnapshotRestoreProgress({
      unresponsive: true,
      lastSavedAt: new Date('2026-06-12T15:04:05Z'),
      timeZone: 'UTC',
    })).toEqual({
      title: "Deck's terminal server is unresponsive. Restarting…",
      message: 'Restoring terminals from Jun 12, 2026, 3:04 PM.',
    });
  });

  it('omits the last-save time on first run', () => {
    expect(formatTerminalSnapshotRestoreProgress({ unresponsive: false })).toEqual({
      title: "Restoring Deck's terminals…",
      message: 'Restoring terminals…',
    });
  });
});

describe('terminalSnapshotLastSaveTime', () => {
  it('reads resurrect/last mtime', async () => {
    await expect(terminalSnapshotLastSaveTime('/deck', {
      stat: async (path) => {
        expect(path).toBe('/deck/resurrect/last');
        return { mtime: new Date('2026-06-12T15:04:05Z') };
      },
    })).resolves.toEqual(new Date('2026-06-12T15:04:05Z'));
  });

  it('omits the time when resurrect/last is absent', async () => {
    await expect(terminalSnapshotLastSaveTime('/deck', {
      stat: async () => {
        const error = new Error('ENOENT') as Error & { code: string };
        error.code = 'ENOENT';
        throw error;
      },
    })).resolves.toBeUndefined();
  });
});
