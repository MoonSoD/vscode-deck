import { describe, expect, it } from 'vitest';
import { TmuxCli, type CommandRunner, type CommandResult } from '../src/terminal/tmuxCli';

class MockRunner implements CommandRunner {
  readonly calls: Array<{ command: string; args: string[]; cwd?: string }> = [];

  constructor(private readonly results: CommandResult[]) {}

  async run(command: string, args: string[], options?: { cwd?: string }): Promise<CommandResult> {
    this.calls.push({ command, args, cwd: options?.cwd });
    return this.results.shift() ?? { code: 0, stdout: '', stderr: '' };
  }
}

describe('TmuxCli', () => {
  it('does not create a session when it already exists', async () => {
    const runner = new MockRunner([{ code: 0, stdout: '', stderr: '' }]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await tmux.ensureSessionWindow('wt-_work_repo__term-1', 'term-1', '/work/repo');

    expect(runner.calls).toEqual([
      {
        command: 'tmux',
        args: [
          '-L',
          'deck',
          '-f',
          '/ext/resources/deck.conf',
          'has-session',
          '-t',
          '=wt-_work_repo__term-1',
        ],
        cwd: undefined,
      },
    ]);
  });

  it('checks session existence from tmux exit status', async () => {
    const runner = new MockRunner([
      { code: 0, stdout: '', stderr: '' },
      { code: 1, stdout: '', stderr: 'missing' },
    ]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await expect(tmux.hasSession('present')).resolves.toBe(true);
    await expect(tmux.hasSession('missing')).resolves.toBe(false);
  });

  it('retries a duplicate-session race once', async () => {
    const runner = new MockRunner([
      { code: 1, stdout: '', stderr: 'missing' },
      { code: 1, stdout: '', stderr: 'duplicate session: wt-_work_repo__term-1' },
      { code: 0, stdout: '', stderr: '' },
    ]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await tmux.ensureSessionWindow('wt-_work_repo__term-1', 'term-1', '/work/repo');

    expect(runner.calls.map((call) => call.args.slice(4))).toEqual([
      ['has-session', '-t', '=wt-_work_repo__term-1'],
      [
        'new-session',
        '-d',
        '-s',
        'wt-_work_repo__term-1',
        '-n',
        'term-1',
        '-c',
        '/work/repo',
      ],
      ['has-session', '-t', '=wt-_work_repo__term-1'],
    ]);
  });

  it('builds attach args for the Deck socket and exact session target', () => {
    const tmux = new TmuxCli('/ext/resources/deck.conf', new MockRunner([]));

    expect(tmux.attachShellArgs('wt-_work_repo__term-1')).toEqual([
      '-L',
      'deck',
      '-f',
      '/ext/resources/deck.conf',
      'attach-session',
      '-t',
      '=wt-_work_repo__term-1',
    ]);
  });

  it('lists Deck sessions with window names', async () => {
    const runner = new MockRunner([
      {
        code: 0,
        stdout: 'wt-_work_repo__term-1\tzsh\nwt-_work_repo__term-2\tclaude\n',
        stderr: '',
      },
    ]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await expect(tmux.listSessions()).resolves.toEqual([
      { sessionName: 'wt-_work_repo__term-1', windowName: 'zsh' },
      { sessionName: 'wt-_work_repo__term-2', windowName: 'claude' },
    ]);
    expect(runner.calls[0].args).toEqual([
      '-L',
      'deck',
      '-f',
      '/ext/resources/deck.conf',
      'list-sessions',
      '-F',
      '#{session_name}\t#{window_name}',
    ]);
  });
});
