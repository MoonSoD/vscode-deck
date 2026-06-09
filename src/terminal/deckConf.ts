import { resolveDeckTmuxOptions, type DeckTmuxOptions } from './deckTmuxOptions';

export interface DeckConfPaths {
  pluginPath: string;
  resurrectDir: string;
}

export function renderDeckConf(
  template: string,
  paths: DeckConfPaths,
  tmuxOptions: DeckTmuxOptions = resolveDeckTmuxOptions({}),
): string {
  const automaticRenameFormat = tmuxOptions.options.find((option) =>
    option.option === 'automatic-rename-format'
  )?.value;
  const historyLimit = tmuxOptions.options.find((option) =>
    option.option === 'history-limit'
  )?.value ?? '50000';

  return template
    .replaceAll('__DECK_RESURRECT_PLUGIN__', paths.pluginPath)
    .replaceAll('__DECK_RESURRECT_DIR__', paths.resurrectDir)
    .replaceAll(
      '__DECK_AUTOMATIC_RENAME_FORMAT__',
      automaticRenameFormat === null || automaticRenameFormat === undefined
        ? ''
        : `set -g automatic-rename-format ${quoteTmuxConfValue(automaticRenameFormat)}\n`,
    )
    .replaceAll('__DECK_HISTORY_LIMIT__', historyLimit);
}

function quoteTmuxConfValue(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}
