import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { execFileSync } from 'node:child_process';
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
    const worktreePath = '/work/repo:feature.branch';
    const existingSessions = [
      'wt-_work_repo_feature_branch__term-1',
      'wt-_work_repo_feature_branch__term-3',
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
      "    printf 'wt-_work_repo_feature_branch__term-1\\nwt-_work_repo_feature_branch__term-3\\nwt-_work_other__term-9\\n'",
      '    ;;',
      'esac',
    ].join('\n'), { mode: 0o755 });

    execFileSync('sh', ['scripts/create-external-terminal.sh', worktreePath], {
      cwd: process.cwd(),
      env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH ?? ''}` },
    });

    const calls = readFileSync(callsPath, 'utf8').trim().split('\n');
    expect(calls).toEqual([
      '-L deck list-sessions -F #{session_name}',
      `-L deck new-session -d -s ${expectedSession} -e DECK_SESSION=${expectedSession} -c ${worktreePath}`,
    ]);
  });
});
