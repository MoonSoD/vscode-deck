import {
  DEFAULT_HISTORY_LIMIT,
  resolveDeckTmuxOptions,
  type DeckTmuxOption,
  type DeckTmuxOptions,
} from './deckTmuxOptions';

export interface DeckConfPaths {
  pluginPath: string;
  resurrectDir: string;
}

export function renderDeckConf(
  template: string,
  paths: DeckConfPaths,
  tmuxOptions: DeckTmuxOptions = resolveDeckTmuxOptions({}),
): string {
  const automaticRenameFormat = tmuxOptionValue(tmuxOptions, 'automatic-rename-format');
  const historyLimit = tmuxOptionValue(tmuxOptions, 'history-limit') ?? String(DEFAULT_HISTORY_LIMIT);

  return template
    .replaceAll('__DECK_RESURRECT_PLUGIN__', paths.pluginPath)
    .replaceAll('__DECK_RESURRECT_DIR__', paths.resurrectDir)
    .replaceAll(
      '__DECK_AUTOMATIC_RENAME_FORMAT__',
      renderAutomaticRenameFormat(automaticRenameFormat),
    )
    .replaceAll('__DECK_HISTORY_LIMIT__', historyLimit);
}

function tmuxOptionValue(
  tmuxOptions: DeckTmuxOptions,
  optionName: DeckTmuxOption['option'],
): string | null | undefined {
  return tmuxOptions.options.find((option) => option.option === optionName)?.value;
}

function renderAutomaticRenameFormat(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return `set -g automatic-rename-format ${quoteTmuxConfValue(value)}\n`;
}

function quoteTmuxConfValue(value: string): string {
  // tmux config quoting is shell-style, not SQL-style: a literal single quote
  // must close the quoted run, emit an escaped quote, and reopen ('\''). SQL's
  // '' doubling silently strips the quotes on conf load, diverging from the
  // verbatim value the live `set -g` path stores.
  return `'${value.replaceAll("'", "'\\''")}'`;
}
