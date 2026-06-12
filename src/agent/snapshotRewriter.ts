import type { AgentName } from './agentTypes';
import { ResumeTemplate } from './resumeTemplate';

const LINE_TYPE_COLUMN = 0;
const SESSION_NAME_COLUMN = 1;
const FULL_COMMAND_COLUMN = 10;
const MIN_PANE_COLUMNS = FULL_COMMAND_COLUMN + 1;
const SHELL_COMMAND = ':';

export interface AgentSidecar {
  agent: AgentName;
  session_id: string;
  pid: number;
  startTime: string;
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
    columns[FULL_COMMAND_COLUMN] = this.fullCommandFor(sidecar);
    return columns.join('\t');
  }

  private fullCommandFor(sidecar: AgentSidecar | undefined): string {
    if (sidecar) {
      // Bare resume command: resurrect restores a process by `send-keys`-ing this
      // into the pane's already-running shell (not by exec'ing it), so a failed
      // or exited resume simply returns to that shell — non-destructive, and in
      // the user's own shell, with no `sh -lc … exec "$SHELL"` wrapper needed.
      return `:${this.resumeTemplate.render(sidecar.agent, sidecar.session_id)}`;
    }
    return SHELL_COMMAND;
  }
}
