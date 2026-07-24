export interface ChatSessionMetadata {
  entrypoint?: string;
  cwd?: string;
  gitBranch?: string;
  title?: string;
}

// A session file is JSON Lines. Deck needs only a few fields off it: the
// `entrypoint` (which client wrote the session — `claude-vscode` marks a Claude
// VS Code extension window, `cli` a terminal/CLI run), the `cwd` (→ its
// Worktree), the `gitBranch` for the row, and the newest title. Everything else
// on a line — the message content, tool results — is ignored, so lines are
// parsed only until the stable identity fields are known, then only the small
// title lines after that, to keep long conversations cheap to read.
export function parseChatSessionMetadata(content: string): ChatSessionMetadata {
  const meta: ChatSessionMetadata = {};
  let identityComplete = false;

  for (const line of content.split('\n')) {
    if (line === '') continue;
    if (identityComplete && !line.includes('aiTitle') && !line.includes('customTitle')) continue;

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof value !== 'object' || value === null) continue;
    const record = value as Record<string, unknown>;

    if (meta.entrypoint === undefined && typeof record.entrypoint === 'string') meta.entrypoint = record.entrypoint;
    if (meta.cwd === undefined && typeof record.cwd === 'string') meta.cwd = record.cwd;
    if (meta.gitBranch === undefined && typeof record.gitBranch === 'string') meta.gitBranch = record.gitBranch;

    // The title evolves: keep the newest ai-title, and let a user-set
    // custom-title override any auto-generated one.
    if (typeof record.customTitle === 'string') meta.title = record.customTitle;
    else if (typeof record.aiTitle === 'string') meta.title = record.aiTitle;

    identityComplete = meta.entrypoint !== undefined && meta.cwd !== undefined && meta.gitBranch !== undefined;
  }

  return meta;
}
