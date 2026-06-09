import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HookInstaller } from '../src/agent/hookInstaller';

const tempRoots: string[] = [];

describe('HookInstaller', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('installs Claude hooks into an absent settings file', async () => {
    const root = tempRoot();
    const installer = new HookInstaller({
      claudeSettingsPath: join(root, '.claude', 'settings.json'),
      hookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh'),
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    await installer.installClaude();

    const scriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh');
    expect(existsSync(scriptPath)).toBe(true);
    expect(statSync(scriptPath).mode & 0o111).not.toBe(0);
    expect(JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'))).toEqual({
      hooks: {
        SessionStart: [deckHookGroup(scriptPath)],
        UserPromptSubmit: [deckHookGroup(scriptPath)],
      },
    });
  });

  it('is idempotent and preserves foreign Claude hooks', async () => {
    const root = tempRoot();
    const settingsPath = join(root, '.claude', 'settings.json');
    const scriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh');
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      theme: 'dark',
      hooks: {
        SessionStart: [{
          matcher: 'startup',
          hooks: [{ type: 'command', command: '/other/session-start.sh' }],
        }],
      },
    }), 'utf8');
    const installer = new HookInstaller({
      claudeSettingsPath: settingsPath,
      hookScriptPath: scriptPath,
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    await installer.installClaude();
    await installer.installClaude();

    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
      theme: 'dark',
      hooks: {
        SessionStart: [
          {
            matcher: 'startup',
            hooks: [{ type: 'command', command: '/other/session-start.sh' }],
          },
          deckHookGroup(scriptPath),
        ],
        UserPromptSubmit: [deckHookGroup(scriptPath)],
      },
    });
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deck-hook-installer-'));
  tempRoots.push(root);
  return root;
}

function deckHookGroup(scriptPath: string) {
  return {
    matcher: '',
    hooks: [{
      type: 'command',
      command: scriptPath,
      args: ['--deck-agent-session-hook'],
    }],
  };
}
