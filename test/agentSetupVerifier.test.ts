import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentSidecarStore } from '../src/agent/agentSidecarStore';
import { AgentSetupVerifier } from '../src/agent/agentSetupVerifier';

const tempRoots: string[] = [];

describe('AgentSetupVerifier', () => {
  afterEach(() => {
    vi.useRealTimers();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('confirms setup when the first AgentSession sidecar appears', async () => {
    vi.useFakeTimers();
    const store = new AgentSidecarStore(join(tempRoot(), 'hooks'));
    const notifications = notificationsMock();
    const verifier = new AgentSetupVerifier({
      sidecars: store,
      notifications,
      pollIntervalMs: 10,
      timeoutMs: 100,
    });

    verifier.arm();
    await store.write('wt-_work_repo__term-1', { agent: 'claude', session_id: 'abc-123' });
    await vi.advanceTimersByTimeAsync(10);

    await vi.waitFor(() => expect(notifications.showInformationMessage).toHaveBeenCalledWith(
      'Deck captured a Claude AgentSession. Agent resume is set up.',
    ));
    expect(notifications.showWarningMessage).not.toHaveBeenCalled();
  });

  it('warns when no AgentSession sidecar appears before the setup window closes', async () => {
    vi.useFakeTimers();
    const store = new AgentSidecarStore(join(tempRoot(), 'hooks'));
    const notifications = notificationsMock();
    const verifier = new AgentSetupVerifier({
      sidecars: store,
      notifications,
      pollIntervalMs: 10,
      timeoutMs: 100,
    });

    verifier.arm();
    await vi.advanceTimersByTimeAsync(100);

    expect(notifications.showWarningMessage).toHaveBeenCalledWith(
      'Deck has not captured an AgentSession yet. Start or restart Claude/Codex in a Deck Terminal; if this message keeps appearing, agent hooks may not be working.',
    );
    expect(notifications.showInformationMessage).not.toHaveBeenCalled();
  });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'deck-agent-setup-verifier-'));
  tempRoots.push(root);
  return root;
}

function notificationsMock() {
  return {
    showInformationMessage: vi.fn(async () => undefined),
    showWarningMessage: vi.fn(async () => undefined),
  };
}
