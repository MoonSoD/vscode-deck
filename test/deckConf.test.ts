import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderDeckConf } from '../src/terminal/deckConf';

describe('renderDeckConf', () => {
  it('substitutes resurrect paths in the shipped DeckSocket tmux template', () => {
    const template = readFileSync(join(process.cwd(), 'resources', 'deck.conf'), 'utf8');

    expect(renderDeckConf(template, {
      pluginPath: '/ext/resources/plugins/tmux-resurrect/resurrect.tmux',
      resurrectDir: '/global/resurrect',
    })).toBe(
      [
        'set -g automatic-rename on',
        'set -g history-limit 50000',
        'set -g destroy-unattached off',
        'set -g status off',
        'set -g prefix None',
        'set -g prefix2 None',
        'unbind -a -T prefix',
        'unbind -a -T root',
        "set -g @resurrect-dir '/global/resurrect'",
        "set -g @resurrect-capture-pane-contents 'on'",
        "set -g @resurrect-processes ':all:'",
        "run-shell '/ext/resources/plugins/tmux-resurrect/resurrect.tmux'",
        '',
      ].join('\n'),
    );
  });
});
