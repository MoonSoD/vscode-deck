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

    await tmux.ensureSession('wt-_work_repo__term-1', '/work/repo');

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

    await tmux.ensureSession('wt-_work_repo__term-1', '/work/repo');

    expect(runner.calls.map((call) => call.args.slice(4))).toEqual([
      ['has-session', '-t', '=wt-_work_repo__term-1'],
      [
        'new-session',
        '-d',
        '-s',
        'wt-_work_repo__term-1',
        '-e',
        'DECK_SESSION=wt-_work_repo__term-1',
        '-c',
        '/work/repo',
      ],
      ['has-session', '-t', '=wt-_work_repo__term-1'],
    ]);
  });

  it('injects DECK_SESSION when creating a Terminal session', async () => {
    const runner = new MockRunner([
      { code: 1, stdout: '', stderr: 'missing' },
      { code: 0, stdout: '', stderr: '' },
    ]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await tmux.ensureSession('wt-_work_repo__term-1', '/work/repo');

    expect(runner.calls[1].args).toEqual([
      '-L',
      'deck',
      '-f',
      '/ext/resources/deck.conf',
      'new-session',
      '-d',
      '-s',
      'wt-_work_repo__term-1',
      '-e',
      'DECK_SESSION=wt-_work_repo__term-1',
      '-c',
      '/work/repo',
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

  it('runs a script on the Deck socket', async () => {
    const runner = new MockRunner([{ code: 0, stdout: '', stderr: '' }]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await tmux.runShell('/ext/resources/plugins/tmux-resurrect/scripts/save.sh');

    expect(runner.calls).toEqual([{
      command: 'tmux',
      args: [
        '-L',
        'deck',
        '-f',
        '/ext/resources/deck.conf',
        'run-shell',
        '/ext/resources/plugins/tmux-resurrect/scripts/save.sh',
      ],
      cwd: undefined,
    }]);
  });

  it('checks whether the Deck socket server is running', async () => {
    const runner = new MockRunner([
      { code: 0, stdout: '', stderr: '' },
      { code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-1000/deck' },
    ]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await expect(tmux.isServerRunning()).resolves.toBe(true);
    await expect(tmux.isServerRunning()).resolves.toBe(false);

    expect(runner.calls.map((call) => call.args)).toEqual([
      ['-L', 'deck', '-f', '/ext/resources/deck.conf', 'has-session'],
      ['-L', 'deck', '-f', '/ext/resources/deck.conf', 'has-session'],
    ]);
  });

  it('creates an anchor session on the Deck socket', async () => {
    const runner = new MockRunner([{ code: 0, stdout: '', stderr: '' }]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await tmux.newAnchorSession('__deck_anchor', '/work/repo');

    expect(runner.calls).toEqual([{
      command: 'tmux',
      args: [
        '-L',
        'deck',
        '-f',
        '/ext/resources/deck.conf',
        'new-session',
        '-d',
        '-s',
        '__deck_anchor',
        '-c',
        '/work/repo',
      ],
      cwd: undefined,
    }]);
  });

  it('sets a global tmux option on the Deck socket', async () => {
    const runner = new MockRunner([{ code: 0, stdout: '', stderr: '' }]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await tmux.setOption('automatic-rename-format', '#{pane_current_command}');

    expect(runner.calls).toEqual([{
      command: 'tmux',
      args: [
        '-L',
        'deck',
        '-f',
        '/ext/resources/deck.conf',
        'set',
        '-g',
        'automatic-rename-format',
        '#{pane_current_command}',
      ],
      cwd: undefined,
    }]);
  });

  it('unsets a global tmux option on the Deck socket', async () => {
    const runner = new MockRunner([{ code: 0, stdout: '', stderr: '' }]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await tmux.unsetOption('automatic-rename-format');

    expect(runner.calls).toEqual([{
      command: 'tmux',
      args: [
        '-L',
        'deck',
        '-f',
        '/ext/resources/deck.conf',
        'set',
        '-gu',
        'automatic-rename-format',
      ],
      cwd: undefined,
    }]);
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

  it('reads a single session window name via display-message', async () => {
    const runner = new MockRunner([{ code: 0, stdout: 'claude\n', stderr: '' }]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await expect(tmux.windowName('wt-_work_repo__term-1')).resolves.toBe('claude');
    expect(runner.calls[0].args).toEqual([
      '-L',
      'deck',
      '-f',
      '/ext/resources/deck.conf',
      'display-message',
      '-p',
      '-t',
      'wt-_work_repo__term-1',
      '#{window_name}',
    ]);
  });

  it('returns undefined when the window name query fails', async () => {
    const runner = new MockRunner([{ code: 1, stdout: '', stderr: 'no such session' }]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await expect(tmux.windowName('gone')).resolves.toBeUndefined();
  });

  it('filters listed sessions by prefix and treats a missing server as empty', async () => {
    const runner = new MockRunner([
      {
        code: 0,
        stdout: [
          'wt-_work_repo__term-2\tclaude',
          'wt-_work_other__term-1\tzsh',
          'wt-_work_repo__term-1\tterm-1',
        ].join('\n'),
        stderr: '',
      },
      { code: 1, stdout: '', stderr: 'no server running on /tmp/tmux-1000/deck' },
    ]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await expect(tmux.listSessions('wt-_work_repo__term-')).resolves.toEqual([
      { sessionName: 'wt-_work_repo__term-2', windowName: 'claude' },
      { sessionName: 'wt-_work_repo__term-1', windowName: 'term-1' },
    ]);
    await expect(tmux.listSessions('wt-_work_repo__term-')).resolves.toEqual([]);
  });

  it('treats a missing socket file (fresh boot, never new-session\'d) as empty', async () => {
    // tmux emits this when `-L deck` has never been used since boot — the
    // socket file under $TMPDIR/tmux-<uid>/deck doesn't exist yet.
    const runner = new MockRunner([
      {
        code: 1,
        stdout: '',
        stderr: 'error connecting to /private/tmp/tmux-501/deck (No such file or directory)',
      },
    ]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await expect(tmux.listSessions('wt-_work_repo__term-')).resolves.toEqual([]);
  });

  it('kills an exact Deck session target', async () => {
    const runner = new MockRunner([{ code: 0, stdout: '', stderr: '' }]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await tmux.killSession('wt-_work_repo__term-1');

    expect(runner.calls).toEqual([{
      command: 'tmux',
      args: [
        '-L',
        'deck',
        '-f',
        '/ext/resources/deck.conf',
        'kill-session',
        '-t',
        '=wt-_work_repo__term-1',
      ],
      cwd: undefined,
    }]);
  });

  it.each([
    // The shape tmux actually emits when a tab is closed after its shell
    // already exited — missing it made killSession throw and abort the
    // tab-dispose cleanup, stranding the sidebar row.
    ["can't find session", "can't find session: wt-_work_repo__term-1"],
    ['session not found', 'session not found: wt-_work_repo__term-1'],
    ['no server running', 'no server running on /tmp/tmux-1000/deck'],
  ])('swallows kill-session %s errors', async (_name, stderr) => {
    const runner = new MockRunner([{ code: 1, stdout: '', stderr }]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await expect(tmux.killSession('wt-_work_repo__term-1')).resolves.toBeUndefined();
  });

  it('is idempotent when killing the same session twice', async () => {
    const runner = new MockRunner([
      { code: 0, stdout: '', stderr: '' },
      { code: 1, stdout: '', stderr: 'session not found: wt-_work_repo__term-1' },
    ]);
    const tmux = new TmuxCli('/ext/resources/deck.conf', runner);

    await tmux.killSession('wt-_work_repo__term-1');
    await expect(tmux.killSession('wt-_work_repo__term-1')).resolves.toBeUndefined();

    expect(runner.calls).toHaveLength(2);
  });
});
