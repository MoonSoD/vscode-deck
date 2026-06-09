import { statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// `tmux run-shell <script>` returns 126 when the script isn't executable,
// which silently disables reboot-persistence with no user-facing signal.
// vsce packages the on-disk mode, so a re-vendor or stray chmod that drops the
// exec bit would ship a broken plugin. Guard the bit here. (Skipped on Windows,
// where exec bits don't exist and tmux isn't available anyway.)
const SCRIPTS = ['resurrect.tmux', 'scripts/save.sh', 'scripts/restore.sh'];

describe.skipIf(process.platform === 'win32')('vendored tmux-resurrect', () => {
  it.each(SCRIPTS)('ships %s as an executable script', (relativePath) => {
    const path = join(process.cwd(), 'resources', 'plugins', 'tmux-resurrect', relativePath);
    expect(statSync(path).mode & 0o111).not.toBe(0);
  });
});
