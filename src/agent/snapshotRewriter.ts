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

    const sidecar = sidecars.get(columns[SESSION_NAME_COLUMN]);
    columns[FULL_COMMAND_COLUMN] = this.fullCommandFor(
      columns[CURRENT_COMMAND_COLUMN],
      columns[FULL_COMMAND_COLUMN],
      sidecar,
    );
    return columns.join('\t');
  }

  private fullCommandFor(
    currentCommand: string,
    fullCommand: string,
    sidecar: AgentSidecar | undefined,
  ): string {
    if (sidecar && this.isRunningAgent(sidecar.agent, currentCommand, fullCommand)) {
      return `:${this.wrappedResume(sidecar.agent, sidecar.session_id)}`;
    }
    return SHELL_COMMAND;
  }

  // Claude Code reports its version (e.g. "2.1.168") as pane_current_command, not
  // "claude" — so we also inspect the ps-derived full command (column 10), which
  // reads "claude". Either column naming the agent means it's still running; a
  // shell in both means the user exited it.
  private isRunningAgent(
    agent: AgentSidecar['agent'],
    currentCommand: string,
    fullCommand: string,
  ): boolean {
    const names = [currentCommand, commandBasename(fullCommand)];
    if (agent === 'claude') return names.includes('claude');
    return names.some((name) => name === 'codex' || name.startsWith('codex-'));
  }

  private wrappedResume(agent: AgentSidecar['agent'], sessionId: string): string {
    const resumeCommand = this.resumeTemplate.render(agent, sessionId);
    return `sh -lc '${shellQuote(`${resumeCommand}; exec "$SHELL"`)}'`;
  }
}

function shellQuote(value: string): string {
  return value.replaceAll("'", "'\"'\"'");
}

function commandBasename(fullCommand: string): string {
  const command = fullCommand.startsWith(':') ? fullCommand.slice(1) : fullCommand;
  const firstToken = command.trim().split(/\s+/)[0] ?? '';
  const slash = firstToken.lastIndexOf('/');
  return slash >= 0 ? firstToken.slice(slash + 1) : firstToken;
}
