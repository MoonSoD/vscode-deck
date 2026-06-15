import { describe, expect, it } from 'vitest';
import { resolveTerminalLabel } from '../src/terminal/terminalLabelResolver';

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

  it('falls back to the agent identity when the stripped AgentTitle is empty', () => {
    expect(resolveTerminalLabel('claude', '✳   ')).toBe('claude');
    expect(resolveTerminalLabel('codex', undefined)).toBe('codex');
  });
});
