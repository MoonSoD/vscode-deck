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
    if (sidecar && this.isRunningAgent(sidecar.agent, currentCommand)) {
      columns[10] = `:${this.wrappedResume(sidecar.agent, sidecar.session_id)}`;
    }
    return columns.join('\t');
  }

  private isRunningAgent(agent: AgentSidecar['agent'], currentCommand: string): boolean {
    if (agent === 'claude') return currentCommand === 'claude';
    return currentCommand === 'codex' || currentCommand.startsWith('codex-');
  }

  private wrappedResume(agent: AgentSidecar['agent'], sessionId: string): string {
    const resumeCommand = agent === 'claude'
      ? `claude --resume ${sessionId}`
      : `codex resume ${sessionId}`;
    return `sh -lc '${shellQuote(`${resumeCommand}; exec "$SHELL"`)}'`;
  }
}

function shellQuote(value: string): string {
  return value.replaceAll("'", "'\"'\"'");
}
