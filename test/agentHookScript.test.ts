import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { renderAgentHookScript } from '../src/agent/agentHookScript';

const tempRoots: string[] = [];

describe('renderAgentHookScript', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('writes a Claude sidecar keyed by DECK_SESSION', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"SessionStart"}',
    });

    expect(JSON.parse(readFileSync(join(sidecarDir, 'wt-_work_repo__term-1.json'), 'utf8'))).toEqual({
      agent: 'claude',
      session_id: 'abc-123',
    });
  });

  it('writes a Codex sidecar keyed by DECK_SESSION', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir, 'codex'));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"codex-123","hook_event_name":"SessionStart"}',
    });

    expect(JSON.parse(readFileSync(join(sidecarDir, 'wt-_work_repo__term-1.json'), 'utf8'))).toEqual({
      agent: 'codex',
      session_id: 'codex-123',
    });
  });

  it('no-ops outside Deck when DECK_SESSION is absent', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: undefined },
      input: '{"session_id":"abc-123","hook_event_name":"SessionStart"}',
    });

    expect(existsSync(sidecarDir)).toBe(false);
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deck-agent-hook-'));
  tempRoots.push(root);
  return root;
}

function writeScript(root: string, text: string): string {
  const scriptPath = join(root, 'deck-claude-hook.sh');
  writeFileSync(scriptPath, text, 'utf8');
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function runScript(
  scriptPath: string,
  options: { args?: string[]; env: NodeJS.ProcessEnv; input: string },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile(scriptPath, options.args ?? [], { env: options.env }, (error) => {
      if (error) reject(error);
      else resolve();
    });
    child.stdin?.end(options.input);
  });
}
