import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: {
    from(value: { scheme: string; authority?: string; path: string; query?: string }) {
      return {
        ...value,
        authority: value.authority ?? '',
        query: value.query ?? '',
        toString: () => `${value.scheme}:${value.authority ? `//${value.authority}` : ''}${value.path}${value.query ? `?${value.query}` : ''}`,
      };
    },
  },
}));

import { SessionUriCodec } from '../src/terminal/sessionUriCodec';
import { terminalSessionName } from '../src/terminal/tmuxSafe';

describe('SessionUriCodec', () => {
  it('encodes a terminal as a file-path inside its worktree', () => {
    const codec = new SessionUriCodec();
    const encoded = codec.encode({ worktreePath: '/work/repo', term: 4 });

    expect(encoded.toString()).toBe('deck-terminal:/work/repo/term-4');
    expect(encoded.scheme).toBe('deck-terminal');
    expect(encoded.authority).toBe('');
    expect(encoded.query).toBe('');
  });

  it('round-trips a terminal URI with a worktree path containing spaces and special characters', () => {
    const codec = new SessionUriCodec();
    const encoded = codec.encode({
      worktreePath: '/Users/me/Repository With Spaces+[x]',
      term: 12,
    });

    expect(codec.decode(encoded)).toEqual({
      worktreePath: '/Users/me/Repository With Spaces+[x]',
      term: 12,
      sessionName: terminalSessionName('/Users/me/Repository With Spaces+[x]', 12),
      cwd: '/Users/me/Repository With Spaces+[x]',
    });
  });

  it('encodes equal terminals to byte-equal URI strings', () => {
    const codec = new SessionUriCodec();

    expect(codec.encode({ worktreePath: '/work/repo', term: 1 }).toString()).toBe(
      codec.encode({ worktreePath: '/work/repo', term: 1 }).toString(),
    );
    expect(codec.encode({ worktreePath: '/work/repo', term: 1 }).toString()).not.toBe(
      codec.encode({ worktreePath: '/work/repo', term: 2 }).toString(),
    );
  });

  it('throws for malformed terminal URIs', () => {
    const codec = new SessionUriCodec();

    expect(() =>
      codec.decode({ scheme: 'file', authority: '', path: '/wt-_work_repo__term-1', query: '' } as never),
    ).toThrow('Unexpected terminal URI scheme');
    expect(() =>
      codec.decode({ scheme: 'deck-terminal', authority: 'session', path: '/', query: '' } as never),
    ).toThrow('Malformed terminal URI');
    expect(() =>
      codec.decode({ scheme: 'deck-terminal', authority: '', path: '/work/repo/not-a-terminal', query: '' } as never),
    ).toThrow('Malformed terminal URI');
    expect(() =>
      codec.decode({ scheme: 'deck-terminal', authority: 'session', path: '/work/repo/term-1', query: '' } as never),
    ).toThrow('Malformed terminal URI');
    expect(() =>
      codec.decode({ scheme: 'deck-terminal', authority: '', path: '/work/repo/term-1', query: 'cwd=%2Fwork%2Frepo' } as never),
    ).toThrow('Malformed terminal URI');
  });
});
