import { describe, expect, it } from 'vitest';
import { resolveDeckTmuxOptions } from '../src/terminal/deckTmuxOptions';

describe('resolveDeckTmuxOptions', () => {
  it('unsets an empty automatic rename format', () => {
    expect(resolveDeckTmuxOptions({ automaticRenameFormat: '' })).toEqual({
      options: [{ option: 'automatic-rename-format', value: null }],
      warnings: [],
    });
  });

  it('passes through a rename format', () => {
    expect(resolveDeckTmuxOptions({
      automaticRenameFormat: '#{pane_current_command}:#{pane_current_path}',
    })).toEqual({
      options: [
        { option: 'automatic-rename-format', value: '#{pane_current_command}:#{pane_current_path}' },
      ],
      warnings: [],
    });
  });

  it.each([
    ['newline', 'bad\nformat'],
    ['tab', 'bad\tformat'],
  ])('rejects an automatic rename format containing a %s', (_name, automaticRenameFormat) => {
    expect(resolveDeckTmuxOptions({ automaticRenameFormat })).toEqual({
      options: [{ option: 'automatic-rename-format', value: null }],
      warnings: [
        'deck.tmux.automaticRenameFormat cannot contain tabs or newlines; using tmux default.',
      ],
    });
  });
});
