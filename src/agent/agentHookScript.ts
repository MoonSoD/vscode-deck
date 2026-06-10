import type { AgentName } from './agentTypes';

export function renderAgentHookScript(sidecarDir: string, agent: AgentName = 'claude'): string {
  return [
    '#!/bin/sh',
    'set -eu',
    '',
    `agent="\${2:-${agent}}"`,
    'case "$agent" in',
    '  claude|codex) ;;',
    '  *) exit 0 ;;',
    'esac',
    '',
    'payload=$(cat)',
    'if [ -z "${DECK_SESSION:-}" ]; then',
    '  exit 0',
    'fi',
    '',
    'hook_event_name=$(printf "%s" "$payload" | sed -n \'s/.*"hook_event_name"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\')',
    'if [ "$hook_event_name" = "SessionEnd" ]; then',
    '  tmux -L deck set -w -t "$DECK_SESSION" automatic-rename on || true',
    '  exit 0',
    'fi',
    '',
    'session_id=$(printf "%s" "$payload" | sed -n \'s/.*"session_id"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/p\')',
    'if [ -z "$session_id" ]; then',
    '  exit 0',
    'fi',
    '',
    `sidecar_dir='${quoteForSingleQuotedShell(sidecarDir)}'`,
    'mkdir -p "$sidecar_dir"',
    'printf \'{"agent":"%s","session_id":"%s"}\\n\' "$agent" "$session_id" > "$sidecar_dir/$DECK_SESSION.json"',
    '',
    // Rename last: the sidecar write above is what AgentSession resume depends on,
    // so a naming failure (or a future event missing hook_event_name) must never
    // pre-empt it.
    'case "$hook_event_name" in',
    '  SessionStart|UserPromptSubmit) tmux -L deck rename-window -t "$DECK_SESSION" "$agent" || true ;;',
    'esac',
    '',
  ].join('\n');
}

function quoteForSingleQuotedShell(value: string): string {
  return value.replaceAll("'", "'\"'\"'");
}
