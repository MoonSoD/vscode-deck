import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the Deck modification to the vendored tmux-resurrect restore.sh
// (ADR-0021 Decision 11 / review High-1): a restored session must be created
// with DECK_SESSION so the agent hook keeps writing sidecars after a reboot.
// Re-vendoring the plugin from upstream would silently drop the `-e` flag and
// regress agent-session resume with no other signal — this is the tripwire.
describe('vendored restore.sh DECK_SESSION patch', () => {
  const restoreScript = readFileSync(
    join(process.cwd(), 'resources', 'plugins', 'tmux-resurrect', 'scripts', 'restore.sh'),
    'utf8',
  );

  it('passes DECK_SESSION on every session-creating new-session', () => {
    const sessionCreations = restoreScript
      .split('\n')
      .filter((line) => line.includes('new-session') && line.includes('-s "$session_name"'));

    expect(sessionCreations.length).toBeGreaterThan(0);
    for (const line of sessionCreations) {
      expect(line).toContain('-e "DECK_SESSION=$session_name"');
    }
  });
});
