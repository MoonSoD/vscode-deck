import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HookInstaller } from '../src/agent/hookInstaller';
import { renderAgentHookScript } from '../src/agent/agentHookScript';

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
      codexHooksPath: join(root, '.codex', 'hooks.json'),
      hookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh'),
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    await installer.install(['claude']);

    const scriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh');
    expect(existsSync(scriptPath)).toBe(true);
    expect(statSync(scriptPath).mode & 0o111).not.toBe(0);
    expect(JSON.parse(readFileSync(join(root, '.claude', 'settings.json'), 'utf8'))).toEqual({
      hooks: claudeDeckHooks(scriptPath),
    });
  });

  it('detects legacy Claude hooks separately from current installs', async () => {
    const root = tempRoot();
    const settingsPath = join(root, '.claude', 'settings.json');
    const scriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh');
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [deckHookGroup(scriptPath)],
        UserPromptSubmit: [deckHookGroup(scriptPath)],
        SessionEnd: [deckHookGroup(scriptPath)],
        Stop: [deckHookGroup(scriptPath)],
      },
    }), 'utf8');
    const installer = new HookInstaller({
      claudeSettingsPath: settingsPath,
      codexHooksPath: join(root, '.codex', 'hooks.json'),
      hookScriptPath: scriptPath,
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    await expect(installer.hasDeckHooks('claude')).resolves.toBe(true);
    await expect(installer.isCurrentInstall('claude')).resolves.toBe(false);
  });

  it('previews the exact Claude config change without writing', async () => {
    const root = tempRoot();
    const settingsPath = join(root, '.claude', 'settings.json');
    const scriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh');
    const installer = new HookInstaller({
      claudeSettingsPath: settingsPath,
      codexHooksPath: join(root, '.codex', 'hooks.json'),
      hookScriptPath: scriptPath,
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    const preview = await installer.preview(['claude']);

    expect(preview).toEqual([{
      agent: 'claude',
      configPath: settingsPath,
      contents: `${JSON.stringify({
        hooks: claudeDeckHooks(scriptPath),
      }, null, 2)}\n`,
    }]);
    expect(existsSync(settingsPath)).toBe(false);
    expect(existsSync(scriptPath)).toBe(false);
  });

  it('previews the exact Codex config merge without writing', async () => {
    const root = tempRoot();
    const hooksPath = join(root, '.codex', 'hooks.json');
    const scriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh');
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(hooksPath, JSON.stringify({
      model: 'gpt-5',
      hooks: {
        SessionStart: [{
          matcher: 'startup',
          hooks: [{ type: 'command', command: '/other/session-start.sh' }],
        }],
      },
    }), 'utf8');
    const originalHooks = readFileSync(hooksPath, 'utf8');
    const installer = new HookInstaller({
      claudeSettingsPath: join(root, '.claude', 'settings.json'),
      codexHooksPath: hooksPath,
      hookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh'),
      codexHookScriptPath: scriptPath,
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    const preview = await installer.preview(['codex']);

    expect(preview).toEqual([{
      agent: 'codex',
      configPath: hooksPath,
      contents: `${JSON.stringify({
        model: 'gpt-5',
        hooks: {
          SessionStart: [
            {
              matcher: 'startup',
              hooks: [{ type: 'command', command: '/other/session-start.sh' }],
            },
            codexDeckHookGroup(scriptPath),
          ],
          UserPromptSubmit: [codexDeckHookGroup(scriptPath)],
        },
      }, null, 2)}\n`,
    }]);
    expect(readFileSync(hooksPath, 'utf8')).toBe(originalHooks);
    expect(existsSync(scriptPath)).toBe(false);
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
      codexHooksPath: join(root, '.codex', 'hooks.json'),
      hookScriptPath: scriptPath,
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    await installer.install(['claude']);
    await installer.install(['claude']);

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
        ...claudeDeckHooksWithoutSessionStart(scriptPath),
      },
    });
  });

  it('is idempotent and preserves foreign Codex hooks', async () => {
    const root = tempRoot();
    const hooksPath = join(root, '.codex', 'hooks.json');
    const scriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh');
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(hooksPath, JSON.stringify({
      hooks: {
        SessionStart: [{
          matcher: 'startup',
          hooks: [{ type: 'command', command: '/other/session-start.sh' }],
        }],
      },
    }), 'utf8');
    const installer = new HookInstaller({
      claudeSettingsPath: join(root, '.claude', 'settings.json'),
      codexHooksPath: hooksPath,
      hookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh'),
      codexHookScriptPath: scriptPath,
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    await installer.install(['codex']);
    await installer.install(['codex']);

    expect(JSON.parse(readFileSync(hooksPath, 'utf8'))).toEqual({
      hooks: {
        SessionStart: [
          {
            matcher: 'startup',
            hooks: [{ type: 'command', command: '/other/session-start.sh' }],
          },
          codexDeckHookGroup(scriptPath),
        ],
        UserPromptSubmit: [codexDeckHookGroup(scriptPath)],
      },
    });
  });

  it('preserves foreign Codex hook groups without handlers', async () => {
    const root = tempRoot();
    const hooksPath = join(root, '.codex', 'hooks.json');
    const scriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh');
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(hooksPath, JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: 'startup', hooks: [] },
          { matcher: 'resume' },
        ],
      },
    }), 'utf8');
    const installer = new HookInstaller({
      claudeSettingsPath: join(root, '.claude', 'settings.json'),
      codexHooksPath: hooksPath,
      hookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh'),
      codexHookScriptPath: scriptPath,
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    await installer.install(['codex']);

    expect(JSON.parse(readFileSync(hooksPath, 'utf8'))).toEqual({
      hooks: {
        SessionStart: [
          { matcher: 'startup', hooks: [] },
          { matcher: 'resume' },
          codexDeckHookGroup(scriptPath),
        ],
        UserPromptSubmit: [codexDeckHookGroup(scriptPath)],
      },
    });
  });

  it('installs selected Codex hooks and reports per-agent installation', async () => {
    const root = tempRoot();
    const installer = new HookInstaller({
      claudeSettingsPath: join(root, '.claude', 'settings.json'),
      codexHooksPath: join(root, '.codex', 'hooks.json'),
      hookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh'),
      codexHookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh'),
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    await installer.install(['codex']);

    const codexScriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh');
    expect(existsSync(codexScriptPath)).toBe(true);
    expect(statSync(codexScriptPath).mode & 0o111).not.toBe(0);
    expect(JSON.parse(readFileSync(join(root, '.codex', 'hooks.json'), 'utf8'))).toEqual({
      hooks: {
        SessionStart: [codexDeckHookGroup(codexScriptPath)],
        UserPromptSubmit: [codexDeckHookGroup(codexScriptPath)],
      },
    });
    await expect(installer.isCurrentInstall('codex')).resolves.toBe(true);
    await expect(installer.isCurrentInstall('claude')).resolves.toBe(false);
  });

  it('removes hooks for only the requested agent', async () => {
    const root = tempRoot();
    const installer = new HookInstaller({
      claudeSettingsPath: join(root, '.claude', 'settings.json'),
      codexHooksPath: join(root, '.codex', 'hooks.json'),
      hookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh'),
      codexHookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh'),
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });
    await installer.install(['claude', 'codex']);

    await expect(installer.remove(['codex'])).resolves.toEqual(['codex']);

    await expect(installer.isCurrentInstall('claude')).resolves.toBe(true);
    await expect(installer.isCurrentInstall('codex')).resolves.toBe(false);
  });

  it('removes only Deck hooks from Claude and Codex config files', async () => {
    const root = tempRoot();
    const claudeSettingsPath = join(root, '.claude', 'settings.json');
    const codexHooksPath = join(root, '.codex', 'hooks.json');
    const claudeScriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh');
    const codexScriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh');
    mkdirSync(join(root, '.claude'), { recursive: true });
    mkdirSync(join(root, '.codex'), { recursive: true });
    writeFileSync(claudeSettingsPath, JSON.stringify({
      hooks: {
        SessionStart: [
          deckHookGroup(claudeScriptPath),
          { matcher: 'foreign-without-handlers' },
          {
            matcher: 'startup',
            hooks: [{ type: 'command', command: '/other/claude-session-start.sh' }],
          },
        ],
        ...claudeDeckHooksWithoutSessionStart(claudeScriptPath),
      },
    }), 'utf8');
    writeFileSync(codexHooksPath, JSON.stringify({
      hooks: {
        SessionStart: [
          codexDeckHookGroup(codexScriptPath),
          {
            matcher: 'startup|resume',
            hooks: [{ type: 'command', command: '/other/codex-session-start.sh' }],
          },
        ],
        UserPromptSubmit: [codexDeckHookGroup(codexScriptPath)],
      },
    }), 'utf8');
    const installer = new HookInstaller({
      claudeSettingsPath,
      codexHooksPath,
      hookScriptPath: claudeScriptPath,
      codexHookScriptPath: codexScriptPath,
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    await expect(installer.remove()).resolves.toEqual(['claude', 'codex']);

    expect(JSON.parse(readFileSync(claudeSettingsPath, 'utf8'))).toEqual({
      hooks: {
        SessionStart: [
          { matcher: 'foreign-without-handlers' },
          {
            matcher: 'startup',
            hooks: [{ type: 'command', command: '/other/claude-session-start.sh' }],
          },
        ],
      },
    });
    expect(JSON.parse(readFileSync(codexHooksPath, 'utf8'))).toEqual({
      hooks: {
        SessionStart: [{
          matcher: 'startup|resume',
          hooks: [{ type: 'command', command: '/other/codex-session-start.sh' }],
        }],
      },
    });
  });

  it('treats absent Deck hook entries as a remove no-op', async () => {
    const root = tempRoot();
    const claudeSettingsPath = join(root, '.claude', 'settings.json');
    const codexHooksPath = join(root, '.codex', 'hooks.json');
    mkdirSync(join(root, '.claude'), { recursive: true });
    const originalSettings = JSON.stringify({
      theme: 'dark',
      hooks: {
        SessionStart: [{
          matcher: 'startup',
          hooks: [{ type: 'command', command: '/other/session-start.sh' }],
        }],
      },
    }, null, 2);
    writeFileSync(claudeSettingsPath, originalSettings, 'utf8');
    const installer = new HookInstaller({
      claudeSettingsPath,
      codexHooksPath,
      hookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh'),
      codexHookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh'),
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    await expect(installer.remove()).resolves.toEqual([]);

    expect(readFileSync(claudeSettingsPath, 'utf8')).toBe(originalSettings);
    expect(existsSync(codexHooksPath)).toBe(false);
  });

  it('backs up an existing config to <file>.deck.bak before writing', async () => {
    const root = tempRoot();
    const settingsPath = join(root, '.claude', 'settings.json');
    mkdirSync(join(root, '.claude'), { recursive: true });
    const original = JSON.stringify({ theme: 'dark' });
    writeFileSync(settingsPath, original, 'utf8');
    const installer = new HookInstaller({
      claudeSettingsPath: settingsPath,
      codexHooksPath: join(root, '.codex', 'hooks.json'),
      hookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh'),
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    await installer.install(['claude']);

    expect(readFileSync(`${settingsPath}.deck.bak`, 'utf8')).toBe(original);
  });

  it('writes no backup when the config file did not exist', async () => {
    const root = tempRoot();
    const codexHooksPath = join(root, '.codex', 'hooks.json');
    const installer = new HookInstaller({
      claudeSettingsPath: join(root, '.claude', 'settings.json'),
      codexHooksPath,
      hookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh'),
      codexHookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh'),
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    await installer.install(['codex']);

    expect(existsSync(`${codexHooksPath}.deck.bak`)).toBe(false);
  });

  it('reconciles an installed agent whose hook script drifted from the current build', async () => {
    const root = tempRoot();
    const settingsPath = join(root, '.claude', 'settings.json');
    const scriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh');
    const sidecarDir = join(root, '.local', 'share', 'deck', 'hooks');
    const installer = new HookInstaller({
      claudeSettingsPath: settingsPath,
      codexHooksPath: join(root, '.codex', 'hooks.json'),
      hookScriptPath: scriptPath,
      codexHookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh'),
      sidecarDir,
    });
    await installer.install(['claude']);
    writeFileSync(scriptPath, '#!/bin/sh\n# stale pre-upgrade script\n', 'utf8');

    await expect(installer.reconcileInstalledHooks()).resolves.toEqual([
      { agent: 'claude', configPath: settingsPath },
    ]);

    expect(readFileSync(scriptPath, 'utf8')).toBe(renderAgentHookScript(sidecarDir, 'claude'));
    expect(statSync(scriptPath).mode & 0o111).not.toBe(0);
  });

  it('reconciles a legacy Claude install to the current config and script', async () => {
    const root = tempRoot();
    const settingsPath = join(root, '.claude', 'settings.json');
    const scriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh');
    const sidecarDir = join(root, '.local', 'share', 'deck', 'hooks');
    mkdirSync(join(root, '.claude'), { recursive: true });
    mkdirSync(join(root, '.local', 'share', 'deck', 'bin'), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [deckHookGroup(scriptPath)],
        UserPromptSubmit: [deckHookGroup(scriptPath)],
        SessionEnd: [deckHookGroup(scriptPath)],
        Stop: [deckHookGroup(scriptPath)],
      },
    }), 'utf8');
    const originalSettings = readFileSync(settingsPath, 'utf8');
    writeFileSync(scriptPath, '#!/bin/sh\n# stale pre-status script\n', 'utf8');
    const installer = new HookInstaller({
      claudeSettingsPath: settingsPath,
      codexHooksPath: join(root, '.codex', 'hooks.json'),
      hookScriptPath: scriptPath,
      codexHookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh'),
      sidecarDir,
    });

    await expect(installer.reconcileInstalledHooks()).resolves.toEqual([
      { agent: 'claude', configPath: settingsPath },
    ]);

    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
      hooks: claudeDeckHooks(scriptPath),
    });
    expect(readFileSync(`${settingsPath}.deck.bak`, 'utf8')).toBe(originalSettings);
    expect(readFileSync(scriptPath, 'utf8')).toBe(renderAgentHookScript(sidecarDir, 'claude'));
    expect(statSync(scriptPath).mode & 0o111).not.toBe(0);

    await expect(installer.reconcileInstalledHooks()).resolves.toEqual([]);
  });

  it('removes stale Deck hook groups from events outside the current build', async () => {
    const root = tempRoot();
    const settingsPath = join(root, '.claude', 'settings.json');
    const scriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh');
    mkdirSync(join(root, '.claude'), { recursive: true });
    mkdirSync(join(root, '.local', 'share', 'deck', 'bin'), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [deckHookGroup(scriptPath)],
        ObsoleteDeckEvent: [deckHookGroup(scriptPath)],
      },
    }, null, 2), 'utf8');
    writeFileSync(scriptPath, renderAgentHookScript(join(root, '.local', 'share', 'deck', 'hooks'), 'claude'), 'utf8');
    const installer = new HookInstaller({
      claudeSettingsPath: settingsPath,
      codexHooksPath: join(root, '.codex', 'hooks.json'),
      hookScriptPath: scriptPath,
      codexHookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh'),
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });

    await expect(installer.reconcileInstalledHooks()).resolves.toEqual([
      { agent: 'claude', configPath: settingsPath },
    ]);

    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toEqual({
      hooks: claudeDeckHooks(scriptPath),
    });
  });

  it('reconciles Codex installs through the same activation path', async () => {
    const root = tempRoot();
    const hooksPath = join(root, '.codex', 'hooks.json');
    const scriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh');
    const sidecarDir = join(root, '.local', 'share', 'deck', 'hooks');
    mkdirSync(join(root, '.codex'), { recursive: true });
    mkdirSync(join(root, '.local', 'share', 'deck', 'bin'), { recursive: true });
    writeFileSync(hooksPath, JSON.stringify({
      hooks: {
        SessionStart: [codexDeckHookGroup(scriptPath)],
      },
    }), 'utf8');
    writeFileSync(scriptPath, '#!/bin/sh\n# stale codex script\n', 'utf8');
    const originalHooks = readFileSync(hooksPath, 'utf8');
    const installer = new HookInstaller({
      claudeSettingsPath: join(root, '.claude', 'settings.json'),
      codexHooksPath: hooksPath,
      hookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh'),
      codexHookScriptPath: scriptPath,
      sidecarDir,
    });

    await expect(installer.reconcileInstalledHooks()).resolves.toEqual([
      { agent: 'codex', configPath: hooksPath },
    ]);

    expect(JSON.parse(readFileSync(hooksPath, 'utf8'))).toEqual({
      hooks: {
        SessionStart: [codexDeckHookGroup(scriptPath)],
        UserPromptSubmit: [codexDeckHookGroup(scriptPath)],
      },
    });
    expect(readFileSync(`${hooksPath}.deck.bak`, 'utf8')).toBe(originalHooks);
    expect(readFileSync(scriptPath, 'utf8')).toBe(renderAgentHookScript(sidecarDir, 'codex'));
  });

  it('leaves a current install untouched and never touches an uninstalled agent', async () => {
    const root = tempRoot();
    const claudeScriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh');
    const codexScriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh');
    const settingsPath = join(root, '.claude', 'settings.json');
    const installer = new HookInstaller({
      claudeSettingsPath: settingsPath,
      codexHooksPath: join(root, '.codex', 'hooks.json'),
      hookScriptPath: claudeScriptPath,
      codexHookScriptPath: codexScriptPath,
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });
    await installer.install(['claude']); // codex deliberately not installed
    const originalSettings = readFileSync(settingsPath, 'utf8');
    const originalScript = readFileSync(claudeScriptPath, 'utf8');

    await expect(installer.reconcileInstalledHooks()).resolves.toEqual([]);

    expect(readFileSync(settingsPath, 'utf8')).toBe(originalSettings);
    expect(readFileSync(claudeScriptPath, 'utf8')).toBe(originalScript);
    expect(existsSync(`${settingsPath}.deck.bak`)).toBe(false);
    expect(existsSync(codexScriptPath)).toBe(false);
  });

  it('treats an externally reformatted current config as not drifted', async () => {
    const root = tempRoot();
    const settingsPath = join(root, '.claude', 'settings.json');
    const scriptPath = join(root, '.local', 'share', 'deck', 'bin', 'deck-claude-hook.sh');
    const installer = new HookInstaller({
      claudeSettingsPath: settingsPath,
      codexHooksPath: join(root, '.codex', 'hooks.json'),
      hookScriptPath: scriptPath,
      codexHookScriptPath: join(root, '.local', 'share', 'deck', 'bin', 'deck-codex-hook.sh'),
      sidecarDir: join(root, '.local', 'share', 'deck', 'hooks'),
    });
    await installer.install(['claude']);
    // Another tool (e.g. Claude Code itself) rewrites the same file with its
    // own formatting: different indentation, reordered keys, no trailing newline.
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>;
    const reformatted = JSON.stringify({ theme: 'dark', ...settings }, null, 4);
    writeFileSync(settingsPath, reformatted, 'utf8');

    await expect(installer.reconcileInstalledHooks()).resolves.toEqual([]);

    expect(readFileSync(settingsPath, 'utf8')).toBe(reformatted);
    expect(existsSync(`${settingsPath}.deck.bak`)).toBe(false);
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
      command: `'${scriptPath}' --deck-agent-session-hook claude`,
    }],
  };
}

function claudeDeckHooks(scriptPath: string) {
  return {
    SessionStart: [deckHookGroup(scriptPath)],
    UserPromptSubmit: [deckHookGroup(scriptPath)],
    PreToolUse: [deckHookGroup(scriptPath)],
    PermissionRequest: [deckHookGroup(scriptPath)],
    PostToolUse: [deckHookGroup(scriptPath)],
    PostToolUseFailure: [deckHookGroup(scriptPath)],
    Notification: [deckHookGroup(scriptPath)],
    Stop: [deckHookGroup(scriptPath)],
    StopFailure: [deckHookGroup(scriptPath)],
    SessionEnd: [deckHookGroup(scriptPath)],
  };
}

function claudeDeckHooksWithoutSessionStart(scriptPath: string) {
  const { SessionStart: _sessionStart, ...hooks } = claudeDeckHooks(scriptPath);
  return hooks;
}

function codexDeckHookGroup(scriptPath: string) {
  return {
    matcher: '',
    hooks: [{
      type: 'command',
      command: `'${scriptPath}' --deck-agent-session-hook codex`,
    }],
  };
}
