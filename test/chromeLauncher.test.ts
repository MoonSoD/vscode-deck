import { describe, expect, it } from 'vitest';
import { ChromeLauncher, type ChromeSpawnFactory } from '../src/browser/chromeLauncher';

function fakeSpawn() {
  const calls: { file: string; args: string[]; options: unknown }[] = [];
  let unrefCount = 0;
  const factory: ChromeSpawnFactory = (file, args, options) => {
    calls.push({ file, args, options });
    return { pid: 4242, unref: () => { unrefCount += 1; }, on: () => undefined };
  };
  return { factory, calls, unrefCount: () => unrefCount };
}

const binary = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

describe('ChromeLauncher.launch', () => {
  it('spawns the configured binary as a detached --app window with the profile and debug port', () => {
    const spawn = fakeSpawn();
    const result = new ChromeLauncher(binary, spawn.factory).launch({
      url: 'http://localhost:3042/',
      userDataDir: '/data/deck/chrome/foo-abcd1234',
      debugPort: 9315,
    });

    expect(result).toEqual({ pid: 4242 });
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0].file).toBe(binary);
    expect(spawn.calls[0].args).toEqual([
      '--app=http://localhost:3042/',
      '--user-data-dir=/data/deck/chrome/foo-abcd1234',
      '--remote-debugging-port=9315',
      '--no-first-run',
      '--no-default-browser-check',
    ]);
    expect(spawn.calls[0].options).toEqual({ detached: true, stdio: 'ignore' });
    expect(spawn.unrefCount()).toBe(1);
  });

  it('appends extra args', () => {
    const spawn = fakeSpawn();
    new ChromeLauncher(binary, spawn.factory).launch({
      url: 'http://localhost:3042/',
      userDataDir: '/p',
      debugPort: 9315,
      extraArgs: ['--start-maximized'],
    });
    expect(spawn.calls[0].args.at(-1)).toBe('--start-maximized');
  });
});

describe('ChromeLauncher.raiseApp', () => {
  it('activates Chrome via macOS open', () => {
    const spawn = fakeSpawn();
    new ChromeLauncher(binary, spawn.factory).raiseApp();
    expect(spawn.calls[0].file).toBe('open');
    expect(spawn.calls[0].args).toEqual(['-b', 'com.google.Chrome']);
  });
});
