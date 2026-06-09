import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentDetection } from '../src/agent/agentDetection';

const tempRoots: string[] = [];

describe('AgentDetection', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('detects agents by binary on PATH', async () => {
    const root = tempRoot();
    const bin = join(root, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'claude'), '');
    writeFileSync(join(bin, 'codex'), '');

    await expect(new AgentDetection({
      env: { PATH: bin },
      homeDir: root,
    }).detect()).resolves.toEqual([
      { agent: 'claude', configPath: join(root, '.claude', 'settings.json') },
      { agent: 'codex', configPath: join(root, '.codex', 'hooks.json') },
    ]);
  });

  it('detects agents by config dir and honors config env vars', async () => {
    const root = tempRoot();
    const claudeConfig = join(root, 'custom-claude');
    const codexHome = join(root, 'custom-codex');
    mkdirSync(claudeConfig);
    mkdirSync(codexHome);

    await expect(new AgentDetection({
      env: {
        PATH: '',
        CLAUDE_CONFIG_DIR: claudeConfig,
        CODEX_HOME: codexHome,
      },
      homeDir: root,
    }).detect()).resolves.toEqual([
      { agent: 'claude', configPath: join(claudeConfig, 'settings.json') },
      { agent: 'codex', configPath: join(codexHome, 'hooks.json') },
    ]);
  });

  it('returns empty when no agent binary or config dir exists', async () => {
    const root = tempRoot();

    await expect(new AgentDetection({
      env: { PATH: [join(root, 'missing-a'), join(root, 'missing-b')].join(delimiter) },
      homeDir: root,
    }).detect()).resolves.toEqual([]);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deck-agent-detection-'));
  tempRoots.push(root);
  return root;
}
