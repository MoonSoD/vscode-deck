import { execFile } from 'node:child_process';
import type { AgentName } from './agentTypes';

export interface AgentProcessIdentity {
  agent: AgentName;
  pid: number;
  startTime: string;
}

export interface ProcessProbe {
  isAlive(pid: number): Promise<boolean>;
  startTime(pid: number): Promise<string>;
  command(pid: number): Promise<string>;
}

export class AgentLivenessProbe {
  constructor(private readonly processes: ProcessProbe = new PsProcessProbe()) {}

  async isAgentAlive(process: AgentProcessIdentity): Promise<boolean> {
    if (!(await this.processes.isAlive(process.pid))) return false;
    if ((await this.processes.startTime(process.pid)) !== process.startTime) return false;
    return commandMatchesAgent(await this.processes.command(process.pid), process.agent);
  }
}

export class PsProcessProbe implements ProcessProbe {
  async isAlive(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return error instanceof Error && 'code' in error && error.code === 'EPERM';
    }
  }

  async startTime(pid: number): Promise<string> {
    return this.ps(pid, 'lstart=');
  }

  async command(pid: number): Promise<string> {
    return this.ps(pid, 'command=');
  }

  private async ps(pid: number, output: string): Promise<string> {
    return new Promise((resolve) => {
      execFile('ps', ['-o', output, '-p', String(pid)], (error, stdout) => {
        resolve(error ? '' : stdout.trim().replace(/\s+/g, ' '));
      });
    });
  }
}

function commandMatchesAgent(command: string, agent: AgentName): boolean {
  return command
    .trim()
    .split(/\s+/)
    .some((token) => tokenMatchesAgent(token, agent));
}

function tokenMatchesAgent(token: string, agent: AgentName): boolean {
  return token.split(/[\\/]/).some((part) => pathPartMatchesAgent(part, agent));
}

function pathPartMatchesAgent(part: string, agent: AgentName): boolean {
  if (agent === 'codex') return part === 'codex' || part.startsWith('codex-') || part.startsWith('codex.');
  return part === 'claude' || part.startsWith('claude-') || part.startsWith('claude.');
}
