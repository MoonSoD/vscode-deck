import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentSidecarStore } from '../src/agent/agentSidecarStore';

const tempRoots: string[] = [];

describe('AgentSidecarStore', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('round-trips agent sidecars by Terminal session name', async () => {
    const root = tempRoot();
    const store = new AgentSidecarStore(root);

    await store.write('wt-_work_repo__term-1', {
      agent: 'claude',
      session_id: 'abc-123',
      pid: 111,
      startTime: 'Thu Jun 11 20:00:00 2026',
    });
    await store.write('wt-_work_repo__term-2', {
      agent: 'codex',
      session_id: 'def-456',
      pid: 222,
      startTime: 'Thu Jun 11 20:00:01 2026',
    });

    await expect(store.read('wt-_work_repo__term-1')).resolves.toEqual({
      agent: 'claude',
      session_id: 'abc-123',
      pid: 111,
      startTime: 'Thu Jun 11 20:00:00 2026',
    });
    await expect(store.read('wt-_work_repo__term-2')).resolves.toEqual({
      agent: 'codex',
      session_id: 'def-456',
      pid: 222,
      startTime: 'Thu Jun 11 20:00:01 2026',
    });
    await expect(store.readAll()).resolves.toEqual(new Map([
      ['wt-_work_repo__term-1', {
        agent: 'claude',
        session_id: 'abc-123',
        pid: 111,
        startTime: 'Thu Jun 11 20:00:00 2026',
      }],
      ['wt-_work_repo__term-2', {
        agent: 'codex',
        session_id: 'def-456',
        pid: 222,
        startTime: 'Thu Jun 11 20:00:01 2026',
      }],
    ]));

    await store.remove('wt-_work_repo__term-1');

    await expect(store.readAll()).resolves.toEqual(new Map([
      ['wt-_work_repo__term-2', {
        agent: 'codex',
        session_id: 'def-456',
        pid: 222,
        startTime: 'Thu Jun 11 20:00:01 2026',
      }],
    ]));
  });

  it('reads Codex sidecars by Terminal session name', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'wt-_work_repo__term-1.json'),
      '{"agent":"codex","session_id":"codex-123","pid":333,"startTime":"Thu Jun 11 20:00:02 2026"}\n',
      'utf8',
    );
    const store = new AgentSidecarStore(root);

    await expect(store.readAll()).resolves.toEqual(new Map([
      ['wt-_work_repo__term-1', {
        agent: 'codex',
        session_id: 'codex-123',
        pid: 333,
        startTime: 'Thu Jun 11 20:00:02 2026',
      }],
    ]));
  });

  it('skips malformed sidecars without dropping valid sidecars', async () => {
    const root = tempRoot();
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'wt-_work_repo__term-1.json'),
      '{"agent":"claude","session_id":"abc-123","pid":111,"startTime":"Thu Jun 11 20:00:00 2026"}\n',
      'utf8',
    );
    writeFileSync(join(root, 'wt-_work_repo__term-2.json'), '', 'utf8');
    writeFileSync(join(root, 'wt-_work_repo__term-3.json'), '{"agent":"claude",', 'utf8');
    writeFileSync(join(root, 'wt-_work_repo__term-4.json'), '{"agent":"claude","session_id":"old-schema"}\n', 'utf8');
    const store = new AgentSidecarStore(root);

    await expect(store.readAll()).resolves.toEqual(new Map([
      ['wt-_work_repo__term-1', {
        agent: 'claude',
        session_id: 'abc-123',
        pid: 111,
        startTime: 'Thu Jun 11 20:00:00 2026',
      }],
    ]));
  });

  it('prunes sidecars whose Terminal session no longer exists', async () => {
    const root = tempRoot();
    const store = new AgentSidecarStore(root);
    await store.write('wt-_work_repo__term-1', {
      agent: 'claude',
      session_id: 'abc-123',
      pid: 111,
      startTime: 'Thu Jun 11 20:00:00 2026',
    });
    await store.write('wt-_work_repo__term-2', {
      agent: 'claude',
      session_id: 'def-456',
      pid: 222,
      startTime: 'Thu Jun 11 20:00:01 2026',
    });

    await store.prune(new Set(['wt-_work_repo__term-2']));

    await expect(store.readAll()).resolves.toEqual(new Map([
      ['wt-_work_repo__term-2', {
        agent: 'claude',
        session_id: 'def-456',
        pid: 222,
        startTime: 'Thu Jun 11 20:00:01 2026',
      }],
    ]));
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deck-agent-sidecars-'));
  tempRoots.push(root);
  return root;
}
