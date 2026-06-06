import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('resources/deck.conf', () => {
  it('matches the shipped deck.conf exactly', () => {
    expect(readFileSync(join(process.cwd(), 'resources/deck.conf'), 'utf8')).toBe(
      [
        'set -g automatic-rename on',
        'set -g history-limit 50000',
        'set -g destroy-unattached off',
        'set -g status off',
        'set -g prefix None',
        'set -g prefix2 None',
        'unbind -a -T prefix',
        'unbind -a -T root',
        // set-titles routes the foreground command to the outer terminal
        // (VS Code's editor tab) via OSC, so the tab title tracks the
        // running command dynamically — the API has no Terminal.name setter.
        'set -g set-titles on',
        'set -g set-titles-string "#{pane_current_command}"',
        '',
      ].join('\n'),
    );
  });
});
