import { describe, expect, it } from 'vitest';
import { SnapshotRewriter } from '../src/agent/snapshotRewriter';

describe('SnapshotRewriter', () => {
  it('rewrites a Claude pane with a sidecar to a wrapped resume command', () => {
    const snapshot = [
      [
        'pane',
        'wt-_work_repo__term-1',
        '0',
        '1',
        ':*',
        '0',
        '%0',
        ':/work/repo',
        '1',
        'claude',
        ':claude',
      ].join('\t'),
      [
        'pane',
        'wt-_work_repo__term-2',
        '0',
        '1',
        ':*',
        '0',
        '%1',
        ':/work/repo',
        '1',
        'zsh',
        ':zsh',
      ].join('\t'),
    ].join('\n');

    const rewritten = new SnapshotRewriter().rewrite(snapshot, new Map([
      ['wt-_work_repo__term-1', { agent: 'claude', session_id: 'abc-123' }],
    ]));

    expect(rewritten.split('\n')).toEqual([
      [
        'pane',
        'wt-_work_repo__term-1',
        '0',
        '1',
        ':*',
        '0',
        '%0',
        ':/work/repo',
        '1',
        'claude',
        ':sh -lc \'claude --resume abc-123; exec "$SHELL"\'',
      ].join('\t'),
      [
        'pane',
        'wt-_work_repo__term-2',
        '0',
        '1',
        ':*',
        '0',
        '%1',
        ':/work/repo',
        '1',
        'zsh',
        ':',
      ].join('\t'),
    ]);
  });

  it('restores exited-agent and no-sidecar panes as plain shells', () => {
    const snapshot = [
      paneLine({ session: 'wt-_work_repo__term-1', currentCommand: 'zsh', fullCommand: ':claude' }),
      paneLine({ session: 'wt-_work_repo__term-2', currentCommand: 'claude', fullCommand: ':claude' }),
    ].join('\n');

    const rewritten = new SnapshotRewriter().rewrite(snapshot, new Map([
      ['wt-_work_repo__term-1', { agent: 'claude', session_id: 'abc-123' }],
    ]));

    const lines = rewritten.split('\n');
    expect(lines[0].split('\t')[10]).toBe(':');
    expect(lines[1].split('\t')[10]).toBe(':');
  });

  it('keeps the wrapped command inside the resurrect tab-delimited command column', () => {
    const snapshot = paneLine({
      session: 'wt-_work_repo__term-1',
      currentCommand: 'claude',
      fullCommand: ':claude',
    });

    const rewritten = new SnapshotRewriter().rewrite(snapshot, new Map([
      ['wt-_work_repo__term-1', { agent: 'claude', session_id: 'session with spaces' }],
    ]));

    const columns = rewritten.split('\t');
    expect(columns).toHaveLength(11);
    expect(columns[10]).toBe(':sh -lc \'claude --resume session with spaces; exec "$SHELL"\'');
  });
});

function paneLine(input: {
  session: string;
  currentCommand: string;
  fullCommand: string;
}): string {
  return [
    'pane',
    input.session,
    '0',
    '1',
    ':*',
    '0',
    '%0',
    ':/work/repo',
    '1',
    input.currentCommand,
    input.fullCommand,
  ].join('\t');
}
