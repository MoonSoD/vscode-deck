import { describe, expect, it } from 'vitest';
import { renderDeckConf } from '../src/terminal/deckConf';

describe('renderDeckConf', () => {
  it('substitutes resurrect paths while preserving the DeckSocket tmux options', () => {
    const template = [
      'set -g automatic-rename on',
      'set -g history-limit 50000',
      'set -g destroy-unattached off',
      'set -g status off',
      'set -g prefix None',
      'set -g prefix2 None',
      'unbind -a -T prefix',
      'unbind -a -T root',
      "set -g @resurrect-dir '__DECK_RESURRECT_DIR__'",
      "set -g @resurrect-capture-pane-contents 'on'",
      "set -g @resurrect-processes 'false'",
      "run-shell '__DECK_RESURRECT_PLUGIN__'",
      '',
    ].join('\n');

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
        "set -g @resurrect-processes 'false'",
        "run-shell '/ext/resources/plugins/tmux-resurrect/resurrect.tmux'",
        '',
      ].join('\n'),
    );
  });
});
