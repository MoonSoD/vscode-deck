import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('domain docs', () => {
  it('records AgentStatus as observed AgentSession status with accepted decisions', () => {
    const context = readFileSync(join(process.cwd(), 'CONTEXT.md'), 'utf8');
    const agentStatusEntry = glossaryEntry(context, 'AgentStatus');
    const normalizedAgentStatusEntry = normalizeWhitespace(agentStatusEntry);

    expect(normalizedAgentStatusEntry).toContain('observed status of an AgentSession');
    expect(normalizedAgentStatusEntry).toContain('Terminal');
    expect(normalizedAgentStatusEntry).toContain('InProgress');
    expect(normalizedAgentStatusEntry).toContain('NeedsInput');
    expect(normalizedAgentStatusEntry).toContain('Completed with unread metadata');
    expect(normalizedAgentStatusEntry).toContain('Failed');
    expect(normalizedAgentStatusEntry).toContain('Absence means there is nothing current to report');
    expect(normalizedAgentStatusEntry).toContain('Deck observes it through agent hooks');
    expect(normalizedAgentStatusEntry).toContain('_Avoid_: busy, done, agent state');
    expect(agentStatusEntry).not.toContain('src/');
    expect(agentStatusEntry).not.toContain('.ts');
    expect(agentStatusEntry).not.toContain('status files');

    const adr = readAgentStatusAdr();
    const normalizedAdr = normalizeWhitespace(adr);
    expect(normalizedAdr).toContain('# ADR-0025: Agent status via hooks');
    expect(normalizedAdr).toContain('## Status Accepted');
    expect(normalizedAdr).toContain('hooks-only detection');
    expect(normalizedAdr).toContain('Claude-only v1');
    expect(normalizedAdr).toContain('VS Code ChatSessionStatus');
    expect(normalizedAdr).toContain('read/unread metadata');
    expect(normalizedAdr).toContain('separate disposable status file');
    expect(normalizedAdr).toContain('resume-critical sidecar');
    expect(normalizedAdr).toContain('both default to `always`');
    expect(normalizedAdr).toContain('no Allow action');
    expect(normalizedAdr).toContain('Pattern matching');
    expect(normalizedAdr).toContain('tmux user options');
    expect(normalizedAdr).toContain('Extending the AgentSession sidecar');
    expect(normalizedAdr).toContain('Codex has a parity gap');
    expect(normalizedAdr).toContain('terminal-notifier');
    expect(normalizedAdr).toContain('Deck URI handler');
    expect(normalizedAdr).toContain('Multi-window notifications can be redundant');
  });
});

function glossaryEntry(markdown: string, term: string): string {
  const start = markdown.indexOf(`**${term}**:`);
  if (start === -1) throw new Error(`Missing ${term} glossary entry`);

  const rest = markdown.slice(start);
  const nextEntry = rest.indexOf('\n**', 1);
  return nextEntry === -1 ? rest : rest.slice(0, nextEntry);
}

function readAgentStatusAdr(): string {
  const adrDir = join(process.cwd(), 'docs', 'adr');
  const file = readdirSync(adrDir).find((entry) => entry.endsWith('-agent-status-via-hooks.md'));
  if (!file) throw new Error('Missing agent status ADR');
  return readFileSync(join(adrDir, file), 'utf8');
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ');
}
