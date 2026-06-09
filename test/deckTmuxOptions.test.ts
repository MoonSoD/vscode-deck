import { describe, expect, it } from 'vitest';
import { resolveDeckTmuxOptions } from '../src/terminal/deckTmuxOptions';

describe('resolveDeckTmuxOptions', () => {
  it('unsets an empty automatic rename format and keeps the default history limit', () => {
    expect(resolveDeckTmuxOptions({ automaticRenameFormat: '' })).toEqual({
      options: [
        { option: 'automatic-rename-format', value: null },
        { option: 'history-limit', value: '50000' },
      ],
      warnings: [],
    });
  });

  it('passes through a rename format and positive integer history limit', () => {
    expect(resolveDeckTmuxOptions({
      automaticRenameFormat: '#{pane_current_command}:#{pane_current_path}',
      historyLimit: 120000,
    })).toEqual({
      options: [
        { option: 'automatic-rename-format', value: '#{pane_current_command}:#{pane_current_path}' },
        { option: 'history-limit', value: '120000' },
      ],
      warnings: [],
    });
  });

  it.each([
    ['newline', 'bad\nformat'],
    ['tab', 'bad\tformat'],
  ])('rejects an automatic rename format containing a %s', (_name, automaticRenameFormat) => {
    expect(resolveDeckTmuxOptions({ automaticRenameFormat })).toEqual({
      options: [
        { option: 'automatic-rename-format', value: null },
        { option: 'history-limit', value: '50000' },
      ],
      warnings: [
        'deck.tmux.automaticRenameFormat cannot contain tabs or newlines; using tmux default.',
      ],
    });
  });

  it.each([
    ['non-integer', 10.5],
    ['negative', -1],
    ['NaN', Number.NaN],
  ])('falls back to the default history limit for a %s value', (_name, historyLimit) => {
    expect(resolveDeckTmuxOptions({ historyLimit }).options).toContainEqual({
      option: 'history-limit',
      value: '50000',
    });
  });
});
