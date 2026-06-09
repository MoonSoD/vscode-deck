export interface DeckConfPaths {
  pluginPath: string;
  resurrectDir: string;
}

export function renderDeckConf(template: string, paths: DeckConfPaths): string {
  return template
    .replaceAll('__DECK_RESURRECT_PLUGIN__', paths.pluginPath)
    .replaceAll('__DECK_RESURRECT_DIR__', paths.resurrectDir);
}
