import { describe, expect, it, vi } from 'vitest';

vi.mock('vscode', () => ({
  Uri: {
    from(value: { scheme: string; authority: string; path: string; query: string }) {
      return {
        ...value,
        toString: () => `${value.scheme}://${value.authority}${value.path}?${value.query}`,
      };
    },
  },
}));

import { SessionUriCodec } from '../src/terminal/sessionUriCodec';

describe('SessionUriCodec', () => {
  it('round-trips a terminal session URI with a worktree path containing spaces', () => {
    const codec = new SessionUriCodec();
    const encoded = codec.encode({
      sessionName: 'wt-_Users_me_Project_With_Spaces__term-12',
      cwd: '/Users/me/Project With Spaces',
    });

    expect(codec.decode(encoded)).toEqual({
      sessionName: 'wt-_Users_me_Project_With_Spaces__term-12',
      cwd: '/Users/me/Project With Spaces',
    });
    expect(encoded.scheme).toBe('deck-terminal');
  });

  it('encodes equal sessions to byte-equal URI strings', () => {
    const codec = new SessionUriCodec();

    expect(
      codec.encode({ sessionName: 'wt-_work_repo__term-1', cwd: '/work/repo' }).toString(),
    ).toBe(codec.encode({ sessionName: 'wt-_work_repo__term-1', cwd: '/work/repo' }).toString());
    expect(
      codec.encode({ sessionName: 'wt-_work_repo__term-1', cwd: '/work/repo' }).toString(),
    ).not.toBe(
      codec.encode({ sessionName: 'wt-_work_repo__term-2', cwd: '/work/repo' }).toString(),
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
  });
});
