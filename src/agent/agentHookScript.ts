export function renderAgentHookScript(sidecarDir: string): string {
  return [
    '#!/bin/sh',
    'set -eu',
    '',
    'payload=$(cat)',
    'if [ -z "${DECK_SESSION:-}" ]; then',
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
    'printf \'{"agent":"claude","session_id":"%s"}\\n\' "$session_id" > "$sidecar_dir/$DECK_SESSION.json"',
    '',
  ].join('\n');
}

function quoteForSingleQuotedShell(value: string): string {
  return value.replaceAll("'", "'\"'\"'");
}
