export interface RawDeckTmuxOptions {
  automaticRenameFormat?: unknown;
  historyLimit?: unknown;
}

export interface DeckTmuxOption {
  option: 'automatic-rename-format' | 'history-limit';
  value: string | null;
}

export interface DeckTmuxOptions {
  options: DeckTmuxOption[];
  warnings: string[];
}

export const DEFAULT_HISTORY_LIMIT = 50000;
const INVALID_AUTOMATIC_RENAME_FORMAT_WARNING =
  'deck.tmux.automaticRenameFormat cannot contain tabs or newlines; using tmux default.';

export function resolveDeckTmuxOptions(raw: RawDeckTmuxOptions): DeckTmuxOptions {
  const warnings: string[] = [];
  const automaticRenameFormat = resolveAutomaticRenameFormat(raw.automaticRenameFormat, warnings);

  return {
    options: [
      { option: 'automatic-rename-format', value: automaticRenameFormat },
      { option: 'history-limit', value: String(resolveHistoryLimit(raw.historyLimit)) },
    ],
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

function resolveHistoryLimit(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_HISTORY_LIMIT;
}
