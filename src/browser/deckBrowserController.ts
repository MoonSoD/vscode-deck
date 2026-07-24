import type { ChromeLaunchOptions } from './chromeLauncher';
import { targetPort, type CdpTarget, type CdpVersion } from './cdpClient';
import type { BrowserWorktreeState } from './browserStateStore';
import type { PreviewDefinition } from './previewDefinition';
import { previewPort, previewProfileDir, previewUrl } from './previewPort';

// Minimal boundary interfaces (not the concrete classes, whose private fields
// block structural fakes) — each an SDK-style surface a test can fake directly.
export interface ChromeLauncherLike {
  launch(options: ChromeLaunchOptions): { pid?: number };
  raiseApp(): void;
}

export interface CdpClientLike {
  version(port: number): Promise<CdpVersion | undefined>;
  listTargets(port: number): Promise<CdpTarget[]>;
  activate(port: number, targetId: string): Promise<void>;
  close(port: number, targetId: string): Promise<void>;
}

export interface BrowserStateLike {
  get(worktreePath: string): Promise<BrowserWorktreeState>;
  patch(worktreePath: string, patch: BrowserWorktreeState): Promise<BrowserWorktreeState>;
  delete(worktreePath: string): Promise<void>;
}

export interface DeckBrowserControllerDeps {
  launcher: ChromeLauncherLike;
  cdp: CdpClientLike;
  state: BrowserStateLike;
  deckDir: string;
  allocatePort: () => Promise<number>;
  // Live getter — reflects the current `deck.chromeProfileTemplate` setting.
  profileTemplate: () => string | undefined;
  copyDir: (from: string, to: string) => Promise<void>;
  removeDir: (dir: string) => Promise<void>;
  killPid: (pid: number) => void;
}

// Owns the DeckBrowser: opening, revealing, and closing PreviewWindows. One
// isolated Chrome instance per Worktree (profile + debug port); each preview is a
// `--app` window within it, identified by its unique PreviewPort — so a target is
// matched by port, robust to path redirects. "Open or reveal" mirrors how a
// Terminal tab reveals if already open and otherwise opens.
export class DeckBrowserController {
  constructor(private readonly deps: DeckBrowserControllerDeps) {}

  async openOrReveal(worktreePath: string, def: PreviewDefinition): Promise<void> {
    const profileDir = previewProfileDir(this.deps.deckDir, worktreePath);
    const url = previewUrl(worktreePath, def);
    const port = previewPort(worktreePath, def);

    const state = await this.deps.state.get(worktreePath);
    const liveDebugPort = await this.reachableDebugPort(state.debugPort);

    if (liveDebugPort !== undefined) {
      const target = this.findTarget(await this.deps.cdp.listTargets(liveDebugPort), port);
      if (target) {
        await this.deps.cdp.activate(liveDebugPort, target.id);
      } else {
        // Instance up but this preview not open yet — Chrome routes a same-profile
        // launch into the running instance as a new window.
        this.deps.launcher.launch({ url, userDataDir: profileDir, debugPort: liveDebugPort });
      }
      this.deps.launcher.raiseApp();
      return;
    }

    // Instance down — (re)launch it. Seed the profile once, then allocate and
    // persist a fresh debug port.
    await this.seedProfileOnFirstLaunch(state, profileDir);
    const debugPort = await this.deps.allocatePort();
    const { pid } = this.deps.launcher.launch({ url, userDataDir: profileDir, debugPort });
    await this.deps.state.patch(worktreePath, {
      debugPort,
      profileSeeded: true,
      ...(pid !== undefined ? { pid } : {}),
    });
    this.deps.launcher.raiseApp();
  }

  // Reload a PreviewWindow by closing and reopening its window: HTTP-only CDP has
  // no reload verb, and relaunching the `--app` window into the running instance
  // is an effective refresh.
  async reload(worktreePath: string, def: PreviewDefinition): Promise<void> {
    await this.close(worktreePath, def);
    await this.openOrReveal(worktreePath, def);
  }

  async close(worktreePath: string, def: PreviewDefinition): Promise<void> {
    const state = await this.deps.state.get(worktreePath);
    if (state.debugPort === undefined) return;
    const target = this.findTarget(
      await this.deps.cdp.listTargets(state.debugPort),
      previewPort(worktreePath, def),
    );
    if (target) await this.deps.cdp.close(state.debugPort, target.id);
  }

  // Tear down every PreviewWindow of a Worktree — the PreviewCascade entry point
  // for WorktreeRemoval/RepositoryRemoval. Killing the instance closes all its
  // windows; the profile dir and state entry are then discarded. Best-effort so a
  // failure never blocks git removal.
  async closeWorktree(worktreePath: string): Promise<void> {
    const state = await this.deps.state.get(worktreePath);
    if (state.pid !== undefined) {
      try {
        this.deps.killPid(state.pid);
      } catch {
        // instance already gone
      }
    }
    await this.deps.removeDir(previewProfileDir(this.deps.deckDir, worktreePath)).catch(() => undefined);
    await this.deps.state.delete(worktreePath);
  }

  private async reachableDebugPort(debugPort: number | undefined): Promise<number | undefined> {
    if (debugPort === undefined) return undefined;
    const version = await this.deps.cdp.version(debugPort);
    return version === undefined ? undefined : debugPort;
  }

  private findTarget(targets: readonly CdpTarget[], port: number): CdpTarget | undefined {
    return targets.find((target) => targetPort(target.url) === String(port));
  }

  private async seedProfileOnFirstLaunch(
    state: { profileSeeded?: boolean },
    profileDir: string,
  ): Promise<void> {
    // profileSeeded marks "first launch handled", so the template is only ever
    // copied into a fresh (not-yet-created) profile dir — never over a live one.
    // Limitation: configuring the template after a Worktree's first launch won't
    // retroactively seed it.
    if (state.profileSeeded) return;
    const template = this.deps.profileTemplate();
    if (template === undefined || template.trim() === '') return;
    await this.deps.copyDir(template, profileDir).catch(() => undefined);
  }
}
