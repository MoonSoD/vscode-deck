import { describe, expect, it, vi } from 'vitest';
import { OsNotifier } from '../src/agent/osNotifier';
import type { CommandRunner } from '../src/terminal/tmuxCli';

describe('OsNotifier', () => {
  it('posts and clears grouped terminal-notifier banners on macOS when the binary exists', async () => {
    const runner = fakeRunner();
    const notifier = await OsNotifier.create({ platform: 'darwin', runner });

    await notifier.notify(
      'wt-_work_repo__term-1',
      'Allow Bash(ls)?',
      'vscode://a9a4k.deck/open-terminal?session=wt-_work_repo__term-1',
      'default',
    );
    await notifier.clear('wt-_work_repo__term-1');

    expect(runner.run).toHaveBeenNthCalledWith(1, 'terminal-notifier', ['-help']);
    expect(runner.run).toHaveBeenNthCalledWith(2, 'terminal-notifier', [
      '-group',
      'deck-wt-_work_repo__term-1',
      '-title',
      'Deck',
      '-message',
      'Allow Bash(ls)?',
      '-open',
      'vscode://a9a4k.deck/open-terminal?session=wt-_work_repo__term-1',
      '-sound',
      'default',
    ]);
    expect(runner.run).toHaveBeenNthCalledWith(3, 'terminal-notifier', [
      '-remove',
      'deck-wt-_work_repo__term-1',
    ]);
  });

  it('does not post or clear when terminal-notifier is missing', async () => {
    const runner = fakeRunner();
    runner.run.mockRejectedValueOnce(Object.assign(new Error('spawn terminal-notifier ENOENT'), { code: 'ENOENT' }));
    const notifier = await OsNotifier.create({ platform: 'darwin', runner });

    await notifier.notify('wt-_work_repo__term-1', 'Allow Bash(ls)?', 'vscode://a9a4k.deck/open-terminal');
    await notifier.clear('wt-_work_repo__term-1');

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledWith('terminal-notifier', ['-help']);
  });

  it('does not post or clear when terminal-notifier cannot run successfully', async () => {
    const runner = fakeRunner();
    runner.run.mockResolvedValueOnce({ code: 1, stdout: '', stderr: 'usage failed' });
    const notifier = await OsNotifier.create({ platform: 'darwin', runner });

    await notifier.notify('wt-_work_repo__term-1', 'Allow Bash(ls)?', 'vscode://a9a4k.deck/open-terminal');
    await notifier.clear('wt-_work_repo__term-1');

    expect(runner.run).toHaveBeenCalledTimes(1);
    expect(runner.run).toHaveBeenCalledWith('terminal-notifier', ['-help']);
  });

  it('does nothing on non-macOS platforms', async () => {
    const runner = fakeRunner();
    const notifier = await OsNotifier.create({ platform: 'linux', runner });

    await notifier.notify('wt-_work_repo__term-1', 'Allow Bash(ls)?', 'vscode://a9a4k.deck/open-terminal');
    await notifier.clear('wt-_work_repo__term-1');

    expect(runner.run).not.toHaveBeenCalled();
  });
});

function fakeRunner(): CommandRunner & { run: ReturnType<typeof vi.fn> } {
  return {
    run: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
  };
}
