import { execFile } from 'node:child_process';

export interface AgentProcessIdentity {
  pid: number;
  startTime: string;
}

export interface ProcessProbe {
  isAlive(pid: number): Promise<boolean>;
  startTime(pid: number): Promise<string>;
}

export class AgentLivenessProbe {
  constructor(private readonly processes: ProcessProbe = new PsProcessProbe()) {}

  async isAgentAlive(process: AgentProcessIdentity): Promise<boolean> {
    if (!(await this.processes.isAlive(process.pid))) return false;
    return (await this.processes.startTime(process.pid)) === process.startTime;
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

  private async ps(pid: number, output: string): Promise<string> {
    return new Promise((resolve) => {
      execFile('ps', ['-o', output, '-p', String(pid)], (error, stdout) => {
        resolve(error ? '' : stdout.trim().replace(/\s+/g, ' '));
      });
    });
  }
}
