import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('resources/deck.conf', () => {
  it('matches the shipped deck.conf exactly', () => {
    expect(readFileSync(join(process.cwd(), 'resources/deck.conf'), 'utf8')).toBe(
      [
        'set -g automatic-rename on',
        'set -g history-limit 50000',
        '# No alternate screen on the outer terminal: output flows into xterm\'s normal',
        '# buffer so wheel scroll, find, and snapshot restore work xterm-natively.',
        'set -ga terminal-overrides \',xterm*:smcup@:rmcup@\'',
        'set -g destroy-unattached off',
        'set -g status off',
        'set -g prefix None',
        'set -g prefix2 None',
        'unbind -a -T prefix',
        'unbind -a -T root',
        '',
      ].join('\n'),
    );
  });
});
