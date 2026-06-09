import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AgentSidecar } from './snapshotRewriter';

export class AgentSidecarStore {
  constructor(private readonly root: string) {}

  async read(sessionName: string): Promise<AgentSidecar | undefined> {
    try {
      return parseSidecar(await readFile(this.pathFor(sessionName), 'utf8'));
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async readAll(): Promise<Map<string, AgentSidecar>> {
    let files: string[];
    try {
      files = await readdir(this.root);
    } catch (error) {
      if (isNotFound(error)) return new Map();
      throw error;
    }

    const sidecars = new Map<string, AgentSidecar>();
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const sessionName = file.slice(0, -'.json'.length);
      const sidecar = await this.read(sessionName);
      if (sidecar) sidecars.set(sessionName, sidecar);
    }
    return sidecars;
  }

  async write(sessionName: string, sidecar: AgentSidecar): Promise<void> {
    await mkdir(this.root, { recursive: true });
    await writeFile(this.pathFor(sessionName), `${JSON.stringify(sidecar)}\n`, 'utf8');
  }

  async prune(liveSessions: ReadonlySet<string>): Promise<void> {
    const sidecars = await this.readAll();
    for (const sessionName of sidecars.keys()) {
      if (!liveSessions.has(sessionName)) {
        await rm(this.pathFor(sessionName), { force: true });
      }
    }
  }

  private pathFor(sessionName: string): string {
    return join(this.root, `${sessionName}.json`);
  }
}

function parseSidecar(text: string): AgentSidecar | undefined {
  const value: unknown = JSON.parse(text);
  if (
    typeof value === 'object' &&
    value !== null &&
    (value as { agent?: unknown }).agent === 'claude' &&
    typeof (value as { session_id?: unknown }).session_id === 'string'
  ) {
    return value as AgentSidecar;
  }
  return undefined;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
