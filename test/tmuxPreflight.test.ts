import { describe, expect, it } from 'vitest';
import { tmuxPreflight } from '../src/terminal/tmuxPreflight';
import type { CommandRunner } from '../src/terminal/tmuxCli';

function runner(stdout: string): CommandRunner {
  return {
    run: async () => ({ code: 0, stdout, stderr: '' }),
  };
}

describe('tmuxPreflight', () => {
  it.each([
    ['tmux 3.4', true],
    ['tmux 3.1', true],
    ['tmux next-3.5', true],
    ['tmux 3.0a', false],
  ])('parses %s', async (stdout, available) => {
    const result = await tmuxPreflight(runner(stdout), ['tmux']);

    expect(result.available).toBe(available);
    if (!available) expect(result.reason).toContain(stdout);
  });

  it('returns unavailable when tmux is missing', async () => {
    const result = await tmuxPreflight(
      {
        run: async () => {
          throw Object.assign(new Error('spawn tmux ENOENT'), { code: 'ENOENT' });
        },
      },
      ['tmux'],
    );

    expect(result.available).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('falls through to the next candidate when an earlier one is missing', async () => {
    const calls: string[] = [];
    const result = await tmuxPreflight(
      {
        run: async (command: string) => {
          calls.push(command);
          if (command === 'tmux') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
          return { code: 0, stdout: 'tmux 3.4', stderr: '' };
        },
      },
      ['tmux', '/opt/homebrew/bin/tmux'],
    );

    expect(calls).toEqual(['tmux', '/opt/homebrew/bin/tmux']);
    expect(result.available).toBe(true);
    expect(result.binaryPath).toBe('/opt/homebrew/bin/tmux');
  });

  it('reports the resolved binaryPath when the bare name works', async () => {
    const result = await tmuxPreflight(runner('tmux 3.4'), ['tmux']);

    expect(result.available).toBe(true);
    expect(result.binaryPath).toBe('tmux');
  });
});
