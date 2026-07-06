import { describe, expect, it } from 'vitest';
import { resolveTerminalLabel, resolveTerminalTooltip } from '../src/terminal/terminalLabelResolver';

describe('resolveTerminalLabel', () => {
  it('labels agent terminals with their glyph-stripped AgentTitle', () => {
    expect(resolveTerminalLabel('claude', '✳ fix-dlq-requeue-uploads-deadline')).toBe(
      'fix-dlq-requeue-uploads-deadline',
    );
  });

  it('strips only leading agent title glyphs for known agents', () => {
    expect(resolveTerminalLabel('claude', '⠂ reconcile checkout state')).toBe('reconcile checkout state');
    expect(resolveTerminalLabel('codex', '⠋ thread-title')).toBe('thread-title');
    expect(resolveTerminalLabel('codex', '[ ! ] Action Required alpha-main')).toBe(
      '[ ! ] Action Required alpha-main',
    );
  });

  it('keeps non-agent terminal labels from the window name', () => {
    expect(resolveTerminalLabel('zsh', ':/work/alpha-main')).toBe('zsh');
  });

  it('labels a known agent from AgentTitle when the window name is a volatile process name', () => {
    expect(resolveTerminalLabel('2.1.172', '✳ tracking-service-grpc-gateway-pivot', 'claude')).toBe(
      'tracking-service-grpc-gateway-pivot',
    );
  });

  it('falls back to the agent identity when the stripped AgentTitle is empty', () => {
    expect(resolveTerminalLabel('claude', '✳   ')).toBe('claude');
    expect(resolveTerminalLabel('codex', undefined)).toBe('codex');
    expect(resolveTerminalLabel('2.1.172', '✳   ', 'claude')).toBe('claude');
  });
});

describe('resolveTerminalTooltip', () => {
  it('shows the stable term-N identity from the session name', () => {
    expect(resolveTerminalTooltip('/work/alpha-main', 'wt-_work_alpha-main__term-3')).toBe('term-3');
  });

  it('falls back to the session name when it does not match the worktree', () => {
    expect(resolveTerminalTooltip('/work/alpha-main', 'foreign-session')).toBe('foreign-session');
  });
});
