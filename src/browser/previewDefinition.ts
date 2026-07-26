// A PreviewDefinition declares one named, browsable surface of a Worktree — the
// data behind a PreviewWindow row. Sourced exactly like a TerminalLauncher (a
// committed `<worktree>/.deck/previews.json`, per-Repository `deck.repositoryPreviews`,
// or global `deck.previews`). `portBase` anchors the deterministic PreviewPort
// (see previewPort.ts); `portEnv`, when set, is the env var Deck injects into the
// Worktree's Terminals so the dev server binds the same port the URL points at.
export interface PreviewDefinition {
  name: string;
  portBase: number;
  portEnv?: string;
  path?: string;
  // The dev-server command the ▶ Run button types into a fresh Terminal (with the
  // PreviewPort injected as env). Absent means the preview has no run action —
  // its window can still be opened once something is serving the port.
  command?: string;
}

export function parsePreviewDefinitions(raw: unknown): PreviewDefinition[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    if (typeof entry.name !== 'string' || entry.name.trim() === '') return [];
    if (typeof entry.portBase !== 'number' || !Number.isInteger(entry.portBase) || entry.portBase <= 0) {
      return [];
    }

    const def: PreviewDefinition = { name: entry.name.trim(), portBase: entry.portBase };
    if (typeof entry.portEnv === 'string' && entry.portEnv.trim() !== '') def.portEnv = entry.portEnv.trim();
    if (typeof entry.path === 'string' && entry.path.trim() !== '') def.path = entry.path.trim();
    if (typeof entry.command === 'string' && entry.command.trim() !== '') def.command = entry.command.trim();
    return [def];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
