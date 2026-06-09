import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { renderAgentHookScript } from './agentHookScript';

const DECK_HOOK_ARGS = ['--deck-agent-session-hook'];
const CLAUDE_EVENTS = ['SessionStart', 'UserPromptSubmit'] as const;

export interface HookInstallerPaths {
  claudeSettingsPath: string;
  codexHooksPath?: string;
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

interface HookGroupRemoval {
  groups: HookGroup[];
  removed: boolean;
}

export class HookInstaller {
  constructor(private readonly paths: HookInstallerPaths) {}

  async installClaude(): Promise<void> {
    await this.writeHookScript();

    const settings = await this.readHookConfig(this.paths.claudeSettingsPath);
    settings.hooks = settings.hooks ?? {};
    for (const event of CLAUDE_EVENTS) {
      settings.hooks[event] = [
        ...removeDeckHookGroups(settings.hooks[event] ?? []).groups,
        deckHookGroup(this.paths.hookScriptPath),
      ];
    }

    await mkdir(dirname(this.paths.claudeSettingsPath), { recursive: true });
    await writeFile(this.paths.claudeSettingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  }

  async remove(): Promise<void> {
    await this.removeDeckHooksFrom(this.paths.claudeSettingsPath);
    if (this.paths.codexHooksPath) {
      await this.removeDeckHooksFrom(this.paths.codexHooksPath);
    }
  }

  private async writeHookScript(): Promise<void> {
    await mkdir(dirname(this.paths.hookScriptPath), { recursive: true });
    await writeFile(this.paths.hookScriptPath, renderAgentHookScript(this.paths.sidecarDir), 'utf8');
    await chmod(this.paths.hookScriptPath, 0o755);
  }

  private async readHookConfig(path: string): Promise<AgentHookConfig> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as AgentHookConfig;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
      throw error;
    }
  }

  private async removeDeckHooksFrom(path: string): Promise<void> {
    const settings = await this.readHookConfig(path);
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

    await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
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
    hook.type === 'command' &&
    Array.isArray(hook.args) &&
    hook.args.length === DECK_HOOK_ARGS.length &&
    hook.args.every((arg, index) => arg === DECK_HOOK_ARGS[index])
  );
}
