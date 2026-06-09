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

interface ClaudeSettings {
  hooks?: Record<string, HookGroup[]>;
  [key: string]: unknown;
}

export class HookInstaller {
  constructor(private readonly paths: HookInstallerPaths) {}

  async installClaude(): Promise<void> {
    await this.writeHookScript();

    const settings = await this.readClaudeSettings();
    settings.hooks = settings.hooks ?? {};
    for (const event of CLAUDE_EVENTS) {
      settings.hooks[event] = [
        ...removeDeckHookGroups(settings.hooks[event] ?? []),
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

  private async readClaudeSettings(): Promise<ClaudeSettings> {
    return this.readHookConfig(this.paths.claudeSettingsPath);
  }

  private async readHookConfig(path: string): Promise<ClaudeSettings> {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as ClaudeSettings;
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
      throw error;
    }
  }

  private async removeDeckHooksFrom(path: string): Promise<void> {
    const settings = await this.readHookConfig(path);
    if (!settings.hooks) return;

    const hooks: Record<string, HookGroup[]> = {};
    for (const [event, groups] of Object.entries(settings.hooks)) {
      const remainingGroups = removeDeckHookGroups(groups);
      if (remainingGroups.length > 0) hooks[event] = remainingGroups;
    }

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
