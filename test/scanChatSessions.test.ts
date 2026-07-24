import { describe, expect, it } from 'vitest';
import { scanChatSessions, type ChatSessionScanDeps } from '../src/chat/scanChatSessions';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;

function jsonl(...lines: object[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

interface FakeFs {
  dirs: Record<string, string[]>;
  files: Record<string, { content: string; mtimeMs: number }>;
}

function deps(fs: FakeFs, overrides: Partial<ChatSessionScanDeps> = {}): ChatSessionScanDeps {
  return {
    projectsDir: '/projects',
    now: NOW,
    maxAgeMs: 2 * DAY,
    readdir: async (dir) => {
      const entries = fs.dirs[dir];
      if (entries === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return entries;
    },
    stat: async (filePath) => {
      const file = fs.files[filePath];
      if (file === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return { mtimeMs: file.mtimeMs };
    },
    readFile: async (filePath) => fs.files[filePath]?.content ?? '',
    ...overrides,
  };
}

describe('scanChatSessions', () => {
  it('returns recent claude-vscode sessions with id, cwd, title, branch and mtime', async () => {
    const fs: FakeFs = {
      dirs: { '/projects': ['projA'], '/projects/projA': ['s1.jsonl'] },
      files: {
        '/projects/projA/s1.jsonl': {
          mtimeMs: NOW - DAY,
          content: jsonl(
            { cwd: '/work/frontend', gitBranch: 'main', entrypoint: 'claude-vscode' },
            { type: 'ai-title', aiTitle: 'Debug tests' },
          ),
        },
      },
    };

    const sessions = await scanChatSessions(deps(fs));

    expect(sessions).toEqual([
      {
        sessionId: 's1',
        cwd: '/work/frontend',
        title: 'Debug tests',
        gitBranch: 'main',
        lastModified: NOW - DAY,
      },
    ]);
  });

  it('excludes sessions from other entrypoints such as the cli', async () => {
    const fs: FakeFs = {
      dirs: { '/projects': ['projA'], '/projects/projA': ['s1.jsonl'] },
      files: {
        '/projects/projA/s1.jsonl': {
          mtimeMs: NOW,
          content: jsonl({ cwd: '/work/frontend', entrypoint: 'cli' }),
        },
      },
    };

    expect(await scanChatSessions(deps(fs))).toEqual([]);
  });

  it('excludes sessions older than the max age', async () => {
    const fs: FakeFs = {
      dirs: { '/projects': ['projA'], '/projects/projA': ['old.jsonl'] },
      files: {
        '/projects/projA/old.jsonl': {
          mtimeMs: NOW - 3 * DAY,
          content: jsonl({ cwd: '/work/frontend', entrypoint: 'claude-vscode' }),
        },
      },
    };

    expect(await scanChatSessions(deps(fs))).toEqual([]);
  });

  it('excludes sessions with no cwd to place them under a worktree', async () => {
    const fs: FakeFs = {
      dirs: { '/projects': ['projA'], '/projects/projA': ['s1.jsonl'] },
      files: {
        '/projects/projA/s1.jsonl': { mtimeMs: NOW, content: jsonl({ entrypoint: 'claude-vscode' }) },
      },
    };

    expect(await scanChatSessions(deps(fs))).toEqual([]);
  });

  it('returns an empty list when the projects directory does not exist', async () => {
    expect(await scanChatSessions(deps({ dirs: {}, files: {} }))).toEqual([]);
  });
});
