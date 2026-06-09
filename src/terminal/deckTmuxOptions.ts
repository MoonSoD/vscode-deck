export interface RawDeckTmuxOptions {
  automaticRenameFormat?: unknown;
}

export interface DeckTmuxOption {
  option: 'automatic-rename-format';
  value: string | null;
}

export interface DeckTmuxOptions {
  options: DeckTmuxOption[];
  warnings: string[];
}

const INVALID_AUTOMATIC_RENAME_FORMAT_WARNING =
  'deck.tmux.automaticRenameFormat cannot contain tabs or newlines; using tmux default.';

export function resolveDeckTmuxOptions(raw: RawDeckTmuxOptions): DeckTmuxOptions {
  const warnings: string[] = [];
  const automaticRenameFormat = resolveAutomaticRenameFormat(raw.automaticRenameFormat, warnings);

  return {
    options: [{ option: 'automatic-rename-format', value: automaticRenameFormat }],
    warnings,
  };
}

function resolveAutomaticRenameFormat(value: unknown, warnings: string[]): string | null {
  if (typeof value !== 'string' || value === '') return null;
  if (value.includes('\n') || value.includes('\t')) {
    warnings.push(INVALID_AUTOMATIC_RENAME_FORMAT_WARNING);
    return null;
  }
  return value;
}
