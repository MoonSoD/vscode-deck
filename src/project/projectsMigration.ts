export interface ProjectsMigrationResult {
  merged: string[];
  clearSettings: boolean;
}

export function projectsMigration(
  settingsList: readonly string[],
  globalStateList: readonly string[],
): ProjectsMigrationResult {
  return {
    merged: [...new Set([...globalStateList, ...settingsList])],
    clearSettings: settingsList.length > 0,
  };
}
