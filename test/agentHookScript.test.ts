import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('renders atomic sidecar writes without redirecting into the sidecar path', () => {
    const script = renderAgentHookScript('/tmp/deck/hooks');

    expect(script).not.toContain('> "$sidecar_dir/$DECK_SESSION.json"');
    expect(script).toContain('tmp=$(mktemp "$sidecar_dir/$DECK_SESSION.XXXXXX")');
    expect(script).toContain('mv "$tmp" "$sidecar_dir/$DECK_SESSION.json"');
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

  it('writes a completed status on Stop without writing a sidecar', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"Stop"}',
    });

    expect(existsSync(sidecarDir)).toBe(false);
    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe('completed');
    expect(typeof status.statusAt).toBe('number');
  });

  it('writes an in-progress status on UserPromptSubmit after the sidecar write', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"UserPromptSubmit"}',
    });

    expect(JSON.parse(readFileSync(join(sidecarDir, 'wt-_work_repo__term-1.json'), 'utf8'))).toEqual({
      agent: 'claude',
      session_id: 'abc-123',
    });
    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe('inProgress');
    expect(typeof status.statusAt).toBe('number');
  });

  it.each([
    ['PreToolUse'],
    ['PostToolUse'],
    ['PostToolUseFailure'],
  ])('writes an in-progress status on %s', async (hookEventName) => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: `{"session_id":"abc-123","hook_event_name":"${hookEventName}"}`,
    });

    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe('inProgress');
    expect(typeof status.statusAt).toBe('number');
  });

  it.each([
    ['PreToolUse', 'inProgress'],
    ['PostToolUse', 'inProgress'],
    ['PostToolUseFailure', 'inProgress'],
    ['Stop', 'completed'],
  ])('does not rewrite the sidecar on %s', async (hookEventName, expectedStatus) => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const sidecarPath = join(sidecarDir, 'wt-_work_repo__term-1.json');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const env = { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' };

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"abc-123","hook_event_name":"SessionStart"}',
    });
    const originalSidecar = readFileSync(sidecarPath, 'utf8');

    await runScript(scriptPath, {
      env,
      input: `{"session_id":"def-456","hook_event_name":"${hookEventName}"}`,
    });

    expect(readFileSync(sidecarPath, 'utf8')).toBe(originalSidecar);
    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe(expectedStatus);
  });

  it('writes needs-input with the payload message on PermissionRequest and clears it after approval', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const statusPath = join(statusDir, 'wt-_work_repo__term-1.json');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const env = { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' };

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"abc-123","hook_event_name":"PermissionRequest","message":"Allow Bash?"}',
    });

    expect(JSON.parse(readFileSync(statusPath, 'utf8'))).toMatchObject({
      status: 'needsInput',
      message: 'Allow Bash?',
    });

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"abc-123","hook_event_name":"PostToolUse"}',
    });

    const status = JSON.parse(readFileSync(statusPath, 'utf8'));
    expect(status.status).toBe('inProgress');
    expect(status.message).toBeUndefined();
  });

  it.each([
    ['permission_prompt', 'needsInput', 'Approve edit?'],
    ['elicitation_dialog', 'needsInput', 'Choose an option'],
    ['idle_prompt', 'completed', undefined],
  ])('maps Notification(%s) to %s', async (notificationType, expectedStatus, expectedMessage) => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: JSON.stringify({
        session_id: 'abc-123',
        hook_event_name: 'Notification',
        notification_type: notificationType,
        message: expectedMessage,
      }),
    });

    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe(expectedStatus);
    expect(status.message).toBe(expectedMessage);
  });

  it('keeps escaped quotes intact in the needs-input message', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: JSON.stringify({
        session_id: 'abc-123',
        hook_event_name: 'PermissionRequest',
        message: 'Allow Bash(echo "hi")?',
      }),
    });

    const status = JSON.parse(readFileSync(join(root, 'status', 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.message).toBe('Allow Bash(echo "hi")?');
  });

  it('extracts the top-level message, not tool_input lookalikes', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: JSON.stringify({
        session_id: 'abc-123',
        hook_event_name: 'PermissionRequest',
        // Escaped "message" lookalike ahead of the real field.
        tool_input: { command: 'printf %s {"message":"decoy"}' },
        message: 'Allow Edit?',
        // Unescaped nested message after the real field.
        tool_response: { message: 'trailing decoy' },
      }),
    });

    const status = JSON.parse(readFileSync(join(root, 'status', 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.message).toBe('Allow Edit?');
  });

  it('omits the message key when PermissionRequest carries none', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"PermissionRequest"}',
    });

    const raw = readFileSync(join(root, 'status', 'wt-_work_repo__term-1.json'), 'utf8');
    expect(raw).not.toContain('"message"');
    expect(JSON.parse(raw).status).toBe('needsInput');
  });

  it('keeps the Stop statusAt when idle_prompt later confirms the completion', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusPath = join(root, 'status', 'wt-_work_repo__term-1.json');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const env = { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' };

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"abc-123","hook_event_name":"Stop"}',
    });
    const afterStop = readFileSync(statusPath, 'utf8');

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"abc-123","hook_event_name":"Notification","notification_type":"idle_prompt"}',
    });

    expect(readFileSync(statusPath, 'utf8')).toBe(afterStop);
  });

  it('writes completed on idle_prompt when the recorded status is not completed', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    mkdirSync(statusDir, { recursive: true });
    const statusPath = join(statusDir, 'wt-_work_repo__term-1.json');
    writeFileSync(statusPath, '{"status":"inProgress","statusAt":1710000000}\n', 'utf8');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"Notification","notification_type":"idle_prompt"}',
    });

    expect(JSON.parse(readFileSync(statusPath, 'utf8')).status).toBe('completed');
  });

  it('leaves status unchanged on unknown Notification types', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    mkdirSync(statusDir, { recursive: true });
    const statusPath = join(statusDir, 'wt-_work_repo__term-1.json');
    writeFileSync(statusPath, '{"status":"needsInput","statusAt":1710000000,"message":"still waiting"}\n', 'utf8');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"Notification","notification_type":"unknown"}',
    });

    expect(JSON.parse(readFileSync(statusPath, 'utf8'))).toEqual({
      status: 'needsInput',
      statusAt: 1710000000,
      message: 'still waiting',
    });
  });

  it('writes failed status on StopFailure', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"abc-123","hook_event_name":"StopFailure"}',
    });

    const status = JSON.parse(readFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), 'utf8'));
    expect(status.status).toBe('failed');
    expect(typeof status.statusAt).toBe('number');
  });

  it('keeps the sidecar unchanged when Stop status writing fails', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    writeFileSync(join(root, 'status'), 'not a directory', 'utf8');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const env = { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' };

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"abc-123","hook_event_name":"SessionStart"}',
    });
    const sidecarPath = join(sidecarDir, 'wt-_work_repo__term-1.json');
    const originalSidecar = readFileSync(sidecarPath, 'utf8');

    await runScript(scriptPath, {
      env,
      input: '{"session_id":"def-456","hook_event_name":"Stop"}',
    });

    expect(readFileSync(sidecarPath, 'utf8')).toBe(originalSidecar);
  });

  it('renames the Deck tmux window to the agent on SessionStart', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const tmuxLogPath = writeTmuxStub(root);

    await runScript(scriptPath, {
      env: {
        ...process.env,
        DECK_SESSION: 'wt-_work_repo__term-1',
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      },
      input: '{"session_id":"abc-123","hook_event_name":"SessionStart"}',
    });

    expect(readFileSync(tmuxLogPath, 'utf8')).toBe(
      '-L deck rename-window -t wt-_work_repo__term-1 claude\n',
    );
  });

  it('renames the Deck tmux window to the agent on UserPromptSubmit', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir, 'codex'));
    const tmuxLogPath = writeTmuxStub(root);

    await runScript(scriptPath, {
      env: {
        ...process.env,
        DECK_SESSION: 'wt-_work_repo__term-2',
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      },
      input: '{"session_id":"codex-123","hook_event_name":"UserPromptSubmit"}',
    });

    expect(readFileSync(tmuxLogPath, 'utf8')).toBe(
      '-L deck rename-window -t wt-_work_repo__term-2 codex\n',
    );
  });

  it('restores automatic rename on SessionEnd and deletes status without writing a sidecar', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    mkdirSync(statusDir, { recursive: true });
    writeFileSync(join(statusDir, 'wt-_work_repo__term-1.json'), '{"status":"completed","statusAt":1710000000}\n', 'utf8');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const tmuxLogPath = writeTmuxStub(root);

    await runScript(scriptPath, {
      env: {
        ...process.env,
        DECK_SESSION: 'wt-_work_repo__term-1',
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      },
      input: '{"hook_event_name":"SessionEnd"}',
    });

    expect(readFileSync(tmuxLogPath, 'utf8')).toBe(
      '-L deck set -w -t wt-_work_repo__term-1 automatic-rename on\n',
    );
    expect(existsSync(sidecarDir)).toBe(false);
    expect(existsSync(join(statusDir, 'wt-_work_repo__term-1.json'))).toBe(false);
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

  it('keeps Codex hooks identity-only on UserPromptSubmit', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const statusDir = join(root, 'status');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir, 'codex'));

    await runScript(scriptPath, {
      env: { ...process.env, DECK_SESSION: 'wt-_work_repo__term-1' },
      input: '{"session_id":"codex-123","hook_event_name":"UserPromptSubmit"}',
    });

    expect(JSON.parse(readFileSync(join(sidecarDir, 'wt-_work_repo__term-1.json'), 'utf8'))).toEqual({
      agent: 'codex',
      session_id: 'codex-123',
    });
    expect(existsSync(statusDir)).toBe(false);
  });

  it('no-ops outside Deck when DECK_SESSION is absent', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const tmuxLogPath = writeTmuxStub(root);

    await runScript(scriptPath, {
      env: {
        ...process.env,
        DECK_SESSION: undefined,
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      },
      input: '{"session_id":"abc-123","hook_event_name":"SessionStart"}',
    });

    expect(existsSync(sidecarDir)).toBe(false);
    expect(existsSync(tmuxLogPath)).toBe(false);
  });

  it('no-ops when a start event has no session id', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const tmuxLogPath = writeTmuxStub(root);

    await runScript(scriptPath, {
      env: {
        ...process.env,
        DECK_SESSION: 'wt-_work_repo__term-1',
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      },
      input: '{"hook_event_name":"SessionStart"}',
    });

    expect(existsSync(sidecarDir)).toBe(false);
    expect(existsSync(tmuxLogPath)).toBe(false);
  });

  it('does not write a sidecar when hook_event_name is absent, and issues no rename', async () => {
    const root = tempRoot();
    const sidecarDir = join(root, 'hooks');
    const scriptPath = writeScript(root, renderAgentHookScript(sidecarDir));
    const tmuxLogPath = writeTmuxStub(root);

    await runScript(scriptPath, {
      env: {
        ...process.env,
        DECK_SESSION: 'wt-_work_repo__term-1',
        PATH: `${join(root, 'bin')}:${process.env.PATH ?? ''}`,
      },
      input: '{"session_id":"abc-123"}',
    });

    expect(existsSync(sidecarDir)).toBe(false);
    expect(existsSync(tmuxLogPath)).toBe(false);
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

function writeTmuxStub(root: string): string {
  const binDir = join(root, 'bin');
  const logPath = join(root, 'tmux.log');
  mkdirSync(binDir, { recursive: true });
  const tmuxPath = join(binDir, 'tmux');
  writeFileSync(tmuxPath, `#!/bin/sh\nprintf '%s\\n' "$*" >> '${logPath}'\n`, 'utf8');
  chmodSync(tmuxPath, 0o755);
  return logPath;
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
