export interface AgentSidecar {
  agent: 'claude';
  session_id: string;
}

export class SnapshotRewriter {
  rewrite(snapshotText: string, sidecars: ReadonlyMap<string, AgentSidecar>): string {
    return snapshotText
      .split('\n')
      .map((line) => this.rewriteLine(line, sidecars))
      .join('\n');
  }

  private rewriteLine(line: string, sidecars: ReadonlyMap<string, AgentSidecar>): string {
    const columns = line.split('\t');
    if (columns[0] !== 'pane' || columns.length < 11) return line;

    const sessionName = columns[1];
    const currentCommand = columns[9];
    const sidecar = sidecars.get(sessionName);
    columns[10] =
      sidecar?.agent === 'claude' && currentCommand === 'claude'
        ? `:${this.wrappedClaudeResume(sidecar.session_id)}`
        : ':';
    return columns.join('\t');
  }

  private wrappedClaudeResume(sessionId: string): string {
    return `sh -lc '${shellQuote(`claude --resume ${sessionId}; exec "$SHELL"`)}'`;
  }
}

function shellQuote(value: string): string {
  return value.replaceAll("'", "'\"'\"'");
}
