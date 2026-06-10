import { ExecFileCommandRunner, type CommandRunner } from '../terminal/tmuxCli';

export type OsNotificationSound = 'default';

interface OsNotifierOptions {
  platform?: NodeJS.Platform;
  runner?: CommandRunner;
}

export class OsNotifier {
  static async create(options: OsNotifierOptions = {}): Promise<OsNotifier> {
    const platform = options.platform ?? process.platform;
    const runner = options.runner ?? new ExecFileCommandRunner();
    if (platform !== 'darwin') return new OsNotifier(runner, false);

    try {
      await runner.run('terminal-notifier', ['-help']);
      return new OsNotifier(runner, true);
    } catch {
      return new OsNotifier(runner, false);
    }
  }

  private constructor(
    private readonly runner: CommandRunner,
    private readonly available: boolean,
  ) {}

  async notify(
    sessionName: string,
    message: string,
    deepLink: string,
    sound?: OsNotificationSound,
  ): Promise<void> {
    if (!this.available) return;

    const args = [
      '-group',
      groupName(sessionName),
      '-title',
      'Deck',
      '-message',
      message,
      '-open',
      deepLink,
    ];
    if (sound) args.push('-sound', sound);
    await this.run(args);
  }

  async clear(sessionName: string): Promise<void> {
    if (!this.available) return;
    await this.run(['-remove', groupName(sessionName)]);
  }

  private async run(args: string[]): Promise<void> {
    try {
      await this.runner.run('terminal-notifier', args);
    } catch {
      return;
    }
  }
}

function groupName(sessionName: string): string {
  return `deck-${sessionName}`;
}
