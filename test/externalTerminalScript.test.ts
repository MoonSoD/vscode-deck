import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  allocateTermN,
  terminalSessionName,
} from '../src/terminal/tmuxSafe';

describe('create-external-terminal.sh', () => {
  it('creates the same next session name as Deck and passes the contract flags', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-external-terminal-'));
    const callsPath = join(dir, 'tmux-calls');
    const tmuxPath = join(dir, 'tmux');
    const worktreePath = join(dir, 'repo with spaces\\branch:feature.name');
    mkdirSync(worktreePath);
    const existingSessions = [
      terminalSessionName(worktreePath, 1),
      terminalSessionName(worktreePath, 3),
      'wt-_work_other__term-9',
    ];
    const expectedSession = terminalSessionName(
      worktreePath,
      allocateTermN(worktreePath, existingSessions),
    );

    writeFileSync(tmuxPath, [
      '#!/usr/bin/env sh',
      `printf '%s\\n' "$*" >> ${JSON.stringify(callsPath)}`,
      'case "$*" in',
      '  *"list-sessions"*)',
      `    printf '%s\\n' ${existingSessions.map((session) => JSON.stringify(session)).join(' ')}`,
      '    ;;',
      'esac',
    ].join('\n'), { mode: 0o755 });

    execFileSync('sh', ['scripts/create-external-terminal.sh', worktreePath, 'echo', 'hello'], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ''}` },
    });

    const calls = readFileSync(callsPath, 'utf8').trim().split('\n');
    expect(calls).toEqual([
      '-L deck list-sessions -F #{session_name}',
      `-L deck new-session -d -s ${expectedSession} -e DECK_SESSION=${expectedSession} -c ${worktreePath}`,
      `-L deck send-keys -t =${expectedSession}: -l -- echo hello`,
      `-L deck send-keys -t =${expectedSession}: Enter`,
    ]);
  });

  it('rejects a missing worktree path before creating a tmux session', () => {
    const dir = mkdtempSync(join(tmpdir(), 'deck-external-terminal-'));
    const callsPath = join(dir, 'tmux-calls');
    const tmuxPath = join(dir, 'tmux');
    const missingWorktreePath = join(dir, 'missing-worktree');

    writeFileSync(tmuxPath, [
      '#!/usr/bin/env sh',
      `printf '%s\\n' "$*" >> ${JSON.stringify(callsPath)}`,
    ].join('\n'), { mode: 0o755 });

    const result = spawnSync('sh', ['scripts/create-external-terminal.sh', missingWorktreePath], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ''}` },
      encoding: 'utf8',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(`worktree path is not an existing directory: ${missingWorktreePath}`);
    expect(existsSync(callsPath) ? readFileSync(callsPath, 'utf8') : '').not.toContain('new-session');
  });
});
