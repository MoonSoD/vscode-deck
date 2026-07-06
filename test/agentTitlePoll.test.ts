import { describe, expect, it, vi } from 'vitest';
import { AgentTitlePoll, type AgentTitlePollScheduler } from '../src/agent/agentTitlePoll';
import type { TmuxSession } from '../src/terminal/tmuxCli';

describe('AgentTitlePoll', () => {
  it('emits changed agent sessions when resolved labels change', async () => {
    const scheduler = new ManualScheduler();
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ first task' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/alpha' },
    ];
    const listSessions = vi.fn(async () => sessions);
    const poll = new AgentTitlePoll({
      listSessions,
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
    });
    const changes = vi.fn();
    poll.onChange(changes);

    poll.start();
    await flush();

    sessions = [
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ renamed task' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/beta' },
    ];
    await scheduler.runNext();

    expect(changes).toHaveBeenCalledOnce();
    expect(changes).toHaveBeenCalledWith([
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ renamed task' },
    ]);
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it('pauses while unfocused and catches up on refocus', async () => {
    const scheduler = new ManualScheduler();
    let focused = true;
    let focusHandler: ((focused: boolean) => void) | undefined;
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'codex', paneTitle: '⠋ first task' },
    ];
    const poll = new AgentTitlePoll({
      listSessions: vi.fn(async () => sessions),
      isFocused: () => focused,
      onDidChangeFocus: (handler) => {
        focusHandler = handler;
        return { dispose: vi.fn() };
      },
      scheduler,
    });
    const changes = vi.fn();
    poll.onChange(changes);
    poll.start();
    await flush();

    focused = false;
    focusHandler?.(false);
    sessions = [{ sessionName: 'term-1', windowName: 'codex', paneTitle: '⠋ renamed task' }];
    expect(scheduler.hasTick()).toBe(false);

    focused = true;
    focusHandler?.(true);
    await flush();

    expect(changes).toHaveBeenCalledWith([
      { sessionName: 'term-1', windowName: 'codex', paneTitle: '⠋ renamed task' },
    ]);
    expect(scheduler.hasTick()).toBe(true);
  });

  it('does not fire when only a non-agent terminal changes its pane title', async () => {
    const scheduler = new ManualScheduler();
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ steady task' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/alpha' },
    ];
    const poll = new AgentTitlePoll({
      listSessions: vi.fn(async () => sessions),
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
    });
    const changes = vi.fn();
    poll.onChange(changes);

    poll.start();
    await flush();

    // Only the shell's pane title churns (e.g. a `cd`); the agent's title is
    // unchanged. A non-agent label is its window name, so this must not fire —
    // the agent keeps the poll scheduling.
    sessions = [
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ steady task' },
      { sessionName: 'term-2', windowName: 'zsh', paneTitle: ':/work/beta' },
    ];
    await scheduler.runNext();

    expect(changes).not.toHaveBeenCalled();
  });

  it('emits known agent sessions when a volatile window name would otherwise hide the AgentTitle', async () => {
    const scheduler = new ManualScheduler();
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: '2.1.172', paneTitle: '✳ first task' },
    ];
    const poll = new AgentTitlePoll({
      listSessions: vi.fn(async () => sessions),
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
      resolveAgentName: vi.fn(async (sessionName: string) =>
        sessionName === 'term-1' ? 'claude' : undefined,
      ),
    });
    const changes = vi.fn();
    poll.onChange(changes);

    poll.start();
    await flush();

    sessions = [
      { sessionName: 'term-1', windowName: '2.1.172', paneTitle: '✳ renamed task' },
    ];
    await scheduler.runNext();
    await flush();

    expect(changes).toHaveBeenCalledWith([
      {
        sessionName: 'term-1',
        windowName: '2.1.172',
        paneTitle: '✳ renamed task',
        agentName: 'claude',
      },
    ]);
    expect(scheduler.hasTick()).toBe(true);
  });

  it('stops after a zero-agent tick and resumes on a later start', async () => {
    const scheduler = new ManualScheduler();
    let sessions: TmuxSession[] = [
      { sessionName: 'term-1', windowName: 'zsh', paneTitle: ':/work/alpha' },
    ];
    const poll = new AgentTitlePoll({
      listSessions: vi.fn(async () => sessions),
      isFocused: () => true,
      onDidChangeFocus: () => ({ dispose: vi.fn() }),
      scheduler,
    });
    const changes = vi.fn();
    poll.onChange(changes);

    poll.start();
    await flush();
    expect(scheduler.hasTick()).toBe(false);

    sessions = [
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ started agent' },
    ];
    poll.start();
    await flush();

    expect(changes).toHaveBeenCalledWith([
      { sessionName: 'term-1', windowName: 'claude', paneTitle: '✳ started agent' },
    ]);
    expect(scheduler.hasTick()).toBe(true);
  });
});

class ManualScheduler implements AgentTitlePollScheduler {
  private next: (() => void) | undefined;

  setTimeout(callback: () => void, _ms: number): unknown {
    this.next = callback;
    return callback;
  }

  clearTimeout(handle: unknown): void {
    if (this.next === handle) this.next = undefined;
  }

  hasTick(): boolean {
    return this.next !== undefined;
  }

  async runNext(): Promise<void> {
    const callback = this.next;
    if (!callback) throw new Error('no scheduled tick');
    this.next = undefined;
    callback();
    await Promise.resolve();
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
