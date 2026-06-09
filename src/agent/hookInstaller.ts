import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { renderAgentHookScript } from './agentHookScript';

const DECK_HOOK_ARGS = ['--deck-agent-session-hook'];
const AGENT_EVENTS = ['SessionStart', 'UserPromptSubmit'] as const;

export interface HookInstallerPaths {
  claudeSettingsPath: string;
  codexHooksPath: string;
  hookScriptPath: string;
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

interface AgentHookConfig {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export class HookInstaller {
  constructor(private readonly paths: HookInstallerPaths) {}

  async installClaude(): Promise<void> {
    await this.writeHookScript();

    const settings = await this.readConfig(this.paths.claudeSettingsPath);
    mergeDeckHook(settings, deckClaudeHookGroup(this.paths.hookScriptPath));
    await this.writeConfig(this.paths.claudeSettingsPath, settings);
  }

  async installCodex(): Promise<void> {
    await this.writeHookScript();

    const hooks = await this.readConfig(this.paths.codexHooksPath);
    mergeDeckHook(hooks, deckCodexHookGroup(this.paths.hookScriptPath));
    await this.writeConfig(this.paths.codexHooksPath, hooks);
  }

  private async writeHookScript(): Promise<void> {
    await mkdir(dirname(this.paths.hookScriptPath), { recursive: true });
    await writeFile(this.paths.hookScriptPath, renderAgentHookScript(this.paths.sidecarDir), 'utf8');
    await chmod(this.paths.hookScriptPath, 0o755);
  }

  private async readConfig(path: string): Promise<AgentHookConfig> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as AgentHookConfig;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
      throw error;
    }
  }

  private async writeConfig(path: string, config: AgentHookConfig): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }
}

function mergeDeckHook(config: AgentHookConfig, hookGroup: HookGroup): void {
  config.hooks = config.hooks ?? {};
  for (const event of AGENT_EVENTS) {
    config.hooks[event] = [
      ...removeDeckHookGroups(config.hooks[event] ?? []),
      hookGroup,
    ];
  }
}

function deckClaudeHookGroup(scriptPath: string): HookGroup {
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
