import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';
import type { AgentName, DetectedAgent } from './agentTypes';

interface AgentDetectionOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  pathExists?: (path: string) => Promise<boolean>;
}

interface AgentProbe {
  agent: AgentName;
  binary: string;
  configDir: string;
  configPath: string;
}

export class AgentDetection {
  private readonly env: NodeJS.ProcessEnv;
  private readonly homeDir: string;
  private readonly pathExists: (path: string) => Promise<boolean>;

  constructor(options: AgentDetectionOptions = {}) {
    this.env = options.env ?? process.env;
    this.homeDir = options.homeDir ?? homedir();
    this.pathExists = options.pathExists ?? exists;
  }

  async detect(): Promise<DetectedAgent[]> {
    const detected: DetectedAgent[] = [];
    for (const probe of this.probes()) {
      if (await this.hasBinary(probe.binary) || await this.pathExists(probe.configDir)) {
        detected.push({ agent: probe.agent, configPath: probe.configPath });
      }
    }
    return detected;
  }

  private probes(): AgentProbe[] {
    const claudeConfigDir = this.env.CLAUDE_CONFIG_DIR || join(this.homeDir, '.claude');
    const codexHome = this.env.CODEX_HOME || join(this.homeDir, '.codex');
    return [
      {
        agent: 'claude',
        binary: 'claude',
        configDir: claudeConfigDir,
        configPath: join(claudeConfigDir, 'settings.json'),
      },
      {
        agent: 'codex',
        binary: 'codex',
        configDir: codexHome,
        configPath: join(codexHome, 'hooks.json'),
      },
    ];
  }

  private async hasBinary(binary: string): Promise<boolean> {
    for (const directory of (this.env.PATH ?? '').split(delimiter)) {
      if (directory && await this.pathExists(join(directory, binary))) return true;
    }
    return false;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false;
    throw error;
  }
}
