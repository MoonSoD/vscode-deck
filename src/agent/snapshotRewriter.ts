import type { AgentName } from './agentTypes';
import { ResumeTemplate } from './resumeTemplate';

const LINE_TYPE_COLUMN = 0;
const SESSION_NAME_COLUMN = 1;
const CURRENT_COMMAND_COLUMN = 9;
const FULL_COMMAND_COLUMN = 10;
const MIN_PANE_COLUMNS = FULL_COMMAND_COLUMN + 1;
const SHELL_COMMAND = ':';

export interface AgentSidecar {
  agent: AgentName;
  session_id: string;
}

export class SnapshotRewriter {
  constructor(private readonly resumeTemplate = new ResumeTemplate()) {}

  rewrite(snapshotText: string, sidecars: ReadonlyMap<string, AgentSidecar>): string {
    return snapshotText
      .split('\n')
      .map((line) => this.rewriteLine(line, sidecars))
      .join('\n');
  }

  private rewriteLine(line: string, sidecars: ReadonlyMap<string, AgentSidecar>): string {
    const columns = line.split('\t');
    if (columns[LINE_TYPE_COLUMN] !== 'pane' || columns.length < MIN_PANE_COLUMNS) return line;

    const sessionName = columns[SESSION_NAME_COLUMN];
    const currentCommand = columns[CURRENT_COMMAND_COLUMN];
    const sidecar = sidecars.get(sessionName);

    columns[FULL_COMMAND_COLUMN] = this.fullCommandFor(currentCommand, sidecar);
    return columns.join('\t');
  }

  private fullCommandFor(currentCommand: string, sidecar: AgentSidecar | undefined): string {
    if (sidecar && this.isRunningAgent(sidecar.agent, currentCommand)) {
      return `:${this.wrappedResume(sidecar.agent, sidecar.session_id)}`;
    }
    return SHELL_COMMAND;
  }

  private isRunningAgent(agent: AgentSidecar['agent'], currentCommand: string): boolean {
    if (agent === 'claude') return currentCommand === 'claude';
    return currentCommand === 'codex' || currentCommand.startsWith('codex-');
  }

  private wrappedResume(agent: AgentSidecar['agent'], sessionId: string): string {
    const resumeCommand = this.resumeTemplate.render(agent, sessionId);
    return `sh -lc '${shellQuote(`${resumeCommand}; exec "$SHELL"`)}'`;
  }
}

function shellQuote(value: string): string {
  return value.replaceAll("'", "'\"'\"'");
}
