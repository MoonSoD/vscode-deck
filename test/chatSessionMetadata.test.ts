import { describe, expect, it } from 'vitest';
import { parseChatSessionMetadata } from '../src/chat/chatSessionMetadata';

function jsonl(...lines: object[]): string {
  return lines.map((line) => JSON.stringify(line)).join('\n');
}

describe('parseChatSessionMetadata', () => {
  it('reads entrypoint, cwd and gitBranch from the session lines', () => {
    const content = jsonl(
      { type: 'user', cwd: '/work/frontend', gitBranch: 'main', entrypoint: 'claude-vscode' },
      { type: 'assistant', message: { role: 'assistant' } },
    );

    const meta = parseChatSessionMetadata(content);

    expect(meta.entrypoint).toBe('claude-vscode');
    expect(meta.cwd).toBe('/work/frontend');
    expect(meta.gitBranch).toBe('main');
  });

  it('uses the latest ai-title as the session title', () => {
    const content = jsonl(
      { type: 'user', cwd: '/w', entrypoint: 'claude-vscode' },
      { type: 'ai-title', aiTitle: 'First guess' },
      { type: 'assistant' },
      { type: 'ai-title', aiTitle: 'Debug failing tests' },
    );

    expect(parseChatSessionMetadata(content).title).toBe('Debug failing tests');
  });

  it('prefers a custom-title over the ai-title', () => {
    const content = jsonl(
      { type: 'ai-title', aiTitle: 'Auto summary' },
      { type: 'custom-title', customTitle: 'My renamed chat' },
    );

    expect(parseChatSessionMetadata(content).title).toBe('My renamed chat');
  });

  it('ignores blank lines and unparseable lines', () => {
    const content = ['', 'not json', JSON.stringify({ cwd: '/w', entrypoint: 'cli' }), ''].join('\n');

    expect(parseChatSessionMetadata(content).cwd).toBe('/w');
    expect(parseChatSessionMetadata(content).entrypoint).toBe('cli');
  });

  it('returns an empty result for empty content', () => {
    expect(parseChatSessionMetadata('')).toEqual({});
  });
});
