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

export interface HookPreview {
  agent: AgentName;
  configPath: string;
  contents: string;
}

interface HookGroupRemoval {
  groups: HookGroup[];
  removed: boolean;
}

export class HookInstaller {
  constructor(private readonly paths: HookInstallerPaths) {}

  async install(agents: readonly AgentName[]): Promise<void> {
    for (const agent of agents) {
      await this.installAgent(agent);
    }
  }

  async preview(agents: readonly AgentName[]): Promise<HookPreview[]> {
    const previews: HookPreview[] = [];
    for (const agent of agents) {
      const config = this.configFor(agent);
      previews.push({
        agent,
        configPath: config.configPath,
        contents: await this.renderSettingsWithDeckHooks(config.configPath, config.scriptPath, agent),
      });
    }
    return previews;
  }

  async remove(): Promise<void> {
    await this.removeDeckHooksFrom(this.paths.claudeSettingsPath);
    if (this.paths.codexHooksPath) {
      await this.removeDeckHooksFrom(this.paths.codexHooksPath);
    }
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
    const contents = await this.renderSettingsWithDeckHooks(config.configPath, config.scriptPath, agent);

    await mkdir(dirname(config.configPath), { recursive: true });
    await writeFile(config.configPath, contents, 'utf8');
  }

  private async renderSettingsWithDeckHooks(
    configPath: string,
    scriptPath: string,
    agent: AgentName,
  ): Promise<string> {
    const settings = await this.readSettings(configPath);
    settings.hooks = settings.hooks ?? {};
    for (const event of HOOK_EVENTS) {
      settings.hooks[event] = [
        ...removeDeckHookGroups(settings.hooks[event] ?? []).groups,
        deckHookGroup(scriptPath, agent),
      ];
    }

    return `${JSON.stringify(settings, null, 2)}\n`;
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

  private async removeDeckHooksFrom(configPath: string): Promise<void> {
    const settings = await this.readSettings(configPath);
    if (!settings.hooks) return;

    const hooks = { ...settings.hooks };
    let removed = false;
    for (const [event, groups] of Object.entries(settings.hooks)) {
      const result = removeDeckHookGroups(groups);
      if (!result.removed) continue;
      removed = true;
      if (result.groups.length > 0) {
        hooks[event] = result.groups;
      } else {
        delete hooks[event];
      }
    }

    if (!removed) return;

    if (Object.keys(hooks).length > 0) {
      settings.hooks = hooks;
    } else {
      delete settings.hooks;
    }

    await writeFile(configPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
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

function deckHookGroup(scriptPath: string, agent: AgentName): HookGroup {
  if (agent === 'codex') return deckCodexHookGroup(scriptPath);
  return {
    matcher: '',
    hooks: [{
      type: 'command',
      command: scriptPath,
      args: DECK_HOOK_ARGS,
    }],
  };
}

function deckCodexHookGroup(scriptPath: string): HookGroup {
  return {
    matcher: '',
    hooks: [{
      type: 'command',
      command: `'${quoteForSingleQuotedShell(scriptPath)}' ${DECK_HOOK_ARGS[0]} codex`,
    }],
  };
}

function removeDeckHookGroups(groups: HookGroup[]): HookGroupRemoval {
  let removed = false;
  const remainingGroups: HookGroup[] = [];
  for (const group of groups) {
    if (!group.hooks) {
      remainingGroups.push(group);
      continue;
    }

    const hooks = group.hooks.filter((hook) => !isDeckHook(hook));
    if (hooks.length === group.hooks.length) {
      remainingGroups.push(group);
      continue;
    }

    removed = true;
    if (hooks.length > 0) {
      remainingGroups.push({ ...group, hooks });
    }
  }

  return { groups: remainingGroups, removed };
}

function isDeckHook(hook: HookHandler): boolean {
  return (
    hook.type === 'command' && (
      (
        Array.isArray(hook.args) &&
        hook.args[0] === DECK_HOOK_ARGS[0]
      ) ||
      (
        typeof hook.command === 'string' &&
        hook.command.includes(DECK_HOOK_ARGS[0])
      )
    )
  );
}

function quoteForSingleQuotedShell(value: string): string {
  return value.replaceAll("'", "'\"'\"'");
}
