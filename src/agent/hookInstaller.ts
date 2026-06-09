import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { renderAgentHookScript } from './agentHookScript';
import type { AgentName } from './agentTypes';

const DECK_HOOK_ARGS = ['--deck-agent-session-hook'];
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit'] as const;

export interface HookInstallerPaths {
  claudeSettingsPath: string;
  codexHooksPath?: string;
  hookScriptPath: string;
  codexHookScriptPath?: string;
  sidecarDir: string;
}

interface HookHandler {
  type?: string;
  command?: string;
  args?: unknown;
  [key: string]: unknown;
}

interface HookGroup {
  matcher?: string;
  hooks?: HookHandler[];
  [key: string]: unknown;
}

interface HookSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export class HookInstaller {
  constructor(private readonly paths: HookInstallerPaths) {}

  async install(agents: readonly AgentName[]): Promise<void> {
    for (const agent of agents) {
      await this.installAgent(agent);
    }
  }

  async installClaude(): Promise<void> {
    await this.install(['claude']);
  }

  async isInstalled(agent: AgentName): Promise<boolean> {
    const config = this.configFor(agent);
    const settings = await this.readSettings(config.configPath);
    return HOOK_EVENTS.every((event) =>
      (settings.hooks?.[event] ?? []).some((group) =>
        (group.hooks ?? []).some(isDeckHook),
      ),
    );
  }

  private async installAgent(agent: AgentName): Promise<void> {
    const config = this.configFor(agent);
    await this.writeHookScript(config.scriptPath, agent);

    const settings = await this.readSettings(config.configPath);
    settings.hooks = settings.hooks ?? {};
    for (const event of HOOK_EVENTS) {
      settings.hooks[event] = [
        ...removeDeckHookGroups(settings.hooks[event] ?? []),
        deckHookGroup(config.scriptPath),
      ];
    }

    await mkdir(dirname(config.configPath), { recursive: true });
    await writeFile(config.configPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  }

  private async writeHookScript(scriptPath: string, agent: AgentName): Promise<void> {
    await mkdir(dirname(scriptPath), { recursive: true });
    await writeFile(scriptPath, renderAgentHookScript(this.paths.sidecarDir, agent), 'utf8');
    await chmod(scriptPath, 0o755);
  }

  private async readSettings(configPath: string): Promise<HookSettings> {
    try {
      return JSON.parse(await readFile(configPath, 'utf8')) as HookSettings;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
      throw error;
    }
  }

  private configFor(agent: AgentName): { configPath: string; scriptPath: string } {
    if (agent === 'claude') {
      return {
        configPath: this.paths.claudeSettingsPath,
        scriptPath: this.paths.hookScriptPath,
      };
    }
    if (!this.paths.codexHooksPath || !this.paths.codexHookScriptPath) {
      throw new Error('Codex hook installer paths are not configured');
    }
    return {
      configPath: this.paths.codexHooksPath,
      scriptPath: this.paths.codexHookScriptPath,
    };
  }
}

function deckHookGroup(scriptPath: string): HookGroup {
  return {
    matcher: '',
    hooks: [{
      type: 'command',
      command: scriptPath,
      args: DECK_HOOK_ARGS,
    }],
  };
}

function removeDeckHookGroups(groups: HookGroup[]): HookGroup[] {
  return groups
    .map((group) => ({
      ...group,
      hooks: (group.hooks ?? []).filter((hook) => !isDeckHook(hook)),
    }))
    .filter((group) => (group.hooks ?? []).length > 0);
}

function isDeckHook(hook: HookHandler): boolean {
  return (
    hook.type === 'command' &&
    Array.isArray(hook.args) &&
    hook.args.length === DECK_HOOK_ARGS.length &&
    hook.args.every((arg, index) => arg === DECK_HOOK_ARGS[index])
  );
}
