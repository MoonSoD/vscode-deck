import { join } from 'node:path';
import { parseChatSessionMetadata } from './chatSessionMetadata';

export interface ChatSession {
  sessionId: string;
  cwd: string;
  title?: string;
  gitBranch?: string;
  lastModified: number;
}

export interface ChatSessionScanDeps {
  projectsDir: string;
  now: number;
  maxAgeMs: number;
  readdir(dir: string): Promise<string[]>;
  stat(filePath: string): Promise<{ mtimeMs: number }>;
  readFile(filePath: string): Promise<string>;
}

const CLAUDE_VSCODE_ENTRYPOINT = 'claude-vscode';

// Discovers Claude VS Code extension sessions from the on-disk session store
// (`~/.claude/projects/<key>/<sessionId>.jsonl`). Filters by modification time
// first — the cheap stat gate — so only recent files are read and parsed. Only
// sessions the extension wrote (entrypoint `claude-vscode`) with a cwd are
// returned; a Deck Terminal's own agent (entrypoint `cli`) is left out so it is
// never listed twice.
export async function scanChatSessions(deps: ChatSessionScanDeps): Promise<ChatSession[]> {
  const projectDirs = await readDirSafe(deps, deps.projectsDir);
  const sessions: ChatSession[] = [];

  for (const projectDir of projectDirs) {
    const dirPath = join(deps.projectsDir, projectDir);
    const files = await readDirSafe(deps, dirPath);
    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue;
      const filePath = join(dirPath, file);

      const mtimeMs = await statMtime(deps, filePath);
      if (mtimeMs === undefined || deps.now - mtimeMs > deps.maxAgeMs) continue;

      const meta = parseChatSessionMetadata(await readFileSafe(deps, filePath));
      if (meta.entrypoint !== CLAUDE_VSCODE_ENTRYPOINT || meta.cwd === undefined) continue;

      sessions.push({
        sessionId: file.slice(0, -'.jsonl'.length),
        cwd: meta.cwd,
        ...(meta.title !== undefined ? { title: meta.title } : {}),
        ...(meta.gitBranch !== undefined ? { gitBranch: meta.gitBranch } : {}),
        lastModified: mtimeMs,
      });
    }
  }

  return sessions;
}

async function readDirSafe(deps: ChatSessionScanDeps, dir: string): Promise<string[]> {
  try {
    return await deps.readdir(dir);
  } catch {
    return [];
  }
}

async function statMtime(deps: ChatSessionScanDeps, filePath: string): Promise<number | undefined> {
  try {
    return (await deps.stat(filePath)).mtimeMs;
  } catch {
    return undefined;
  }
}

async function readFileSafe(deps: ChatSessionScanDeps, filePath: string): Promise<string> {
  try {
    return await deps.readFile(filePath);
  } catch {
    return '';
  }
}
