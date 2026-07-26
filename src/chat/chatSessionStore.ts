import { watch, type FSWatcher } from 'node:fs';
import { homedir } from 'node:os';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { scanChatSessions, type ChatSession } from './scanChatSessions';

export interface Disposable {
  dispose(): void;
}

export interface ChatSessionStoreDeps {
  scan(): Promise<ChatSession[]>;
  watch(onChange: () => void): Disposable;
  debounceMs?: number;
}

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

// Owns the live set of Claude VS Code extension sessions: scans the on-disk
// session store once at start, then re-scans (debounced) whenever the projects
// directory changes, and lets the tree read the cache synchronously. The
// counterpart to AgentStatusStore for ChatSessions — worktree-agnostic, so
// consumers place each session under its Worktree by cwd.
export class ChatSessionStore {
  private sessions: readonly ChatSession[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly debounceMs: number;
  private debounceTimer: NodeJS.Timeout | undefined;
  private watchHandle: Disposable | undefined;

  constructor(private readonly deps: ChatSessionStoreDeps) {
    this.debounceMs = deps.debounceMs ?? 200;
  }

  all(): readonly ChatSession[] {
    return this.sessions;
  }

  onDidChange(listener: () => void): Disposable {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  }

  async start(): Promise<Disposable> {
    await this.rescan(false);
    this.watchHandle = this.deps.watch(() => this.scheduleRescan());
    return {
      dispose: () => {
        if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
        this.debounceTimer = undefined;
        this.watchHandle?.dispose();
        this.watchHandle = undefined;
      },
    };
  }

  private scheduleRescan(): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.rescan(true).catch((error) => {
        console.warn('Deck: scanning Claude chat sessions failed', error);
      });
    }, this.debounceMs);
  }

  private async rescan(fire: boolean): Promise<void> {
    const previous = this.sessions;
    this.sessions = await this.deps.scan();
    if (fire && !sameSessions(previous, this.sessions)) {
      for (const listener of this.listeners) listener();
    }
  }
}

// The watch is recursive over the whole projects dir, so a write to any
// session file triggers a rescan — including one filtered out of the result
// entirely (a CLI session's own transcript, entrypoint `cli` not
// `claude-vscode`). Comparing before firing keeps onDidChange (a whole-tree
// refresh) limited to rescans that actually change what would render.
function sameSessions(a: readonly ChatSession[], b: readonly ChatSession[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((session) => [session.sessionId, session]));
  return b.every((session) => {
    const previous = byId.get(session.sessionId);
    return (
      previous !== undefined
      && previous.cwd === session.cwd
      && previous.title === session.title
      && previous.gitBranch === session.gitBranch
      && previous.lastModified === session.lastModified
    );
  });
}

// Wires a ChatSessionStore to the real `~/.claude/projects` directory. The
// watch is recursive so a write inside any project subdirectory nudges a
// re-scan; it degrades to a no-op watcher if the directory is absent.
export function createChatSessionStore(
  options: { env?: NodeJS.ProcessEnv; homeDir?: string; maxAgeMs?: number; now?: () => number } = {},
): ChatSessionStore {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const claudeConfigDir = env.CLAUDE_CONFIG_DIR || join(home, '.claude');
  const projectsDir = join(claudeConfigDir, 'projects');
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? TWO_DAYS_MS;

  return new ChatSessionStore({
    scan: () =>
      scanChatSessions({
        projectsDir,
        now: now(),
        maxAgeMs,
        readdir: (dir) => readdir(dir),
        stat: (filePath) => stat(filePath),
        readFile: (filePath) => readFile(filePath, 'utf8'),
      }),
    watch: (onChange) => {
      let watcher: FSWatcher | undefined;
      try {
        watcher = watch(projectsDir, { recursive: true }, () => onChange());
        watcher.on('error', () => undefined);
      } catch {
        watcher = undefined;
      }
      return { dispose: () => watcher?.close() };
    },
  });
}
