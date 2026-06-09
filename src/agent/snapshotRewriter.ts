import type { AgentName } from './agentTypes';

export interface AgentSidecar {
  agent: AgentName;
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
    columns[10] = ':';
    if (sidecar?.agent === 'claude' && currentCommand === 'claude') {
      columns[10] = `:${this.wrappedResume(`claude --resume ${sidecar.session_id}`)}`;
    }
    if (sidecar?.agent === 'codex' && currentCommand.startsWith('codex')) {
      columns[10] = `:${this.wrappedResume(`codex resume ${sidecar.session_id}`)}`;
    }
    return columns.join('\t');
  }

  private wrappedResume(command: string): string {
    return `sh -lc '${shellQuote(`${command}; exec "$SHELL"`)}'`;
  }
}

function shellQuote(value: string): string {
  return value.replaceAll("'", "'\"'\"'");
}
