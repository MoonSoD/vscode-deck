import * as path from 'node:path';

export const CLAUDE_EXTENSION_ID = 'anthropic.claude-code';

export interface OpenChatSessionTarget {
  sessionId: string;
  worktreePath: string;
  worktreeLabel: string;
}

export interface OpenChatSessionDeps {
  isExtensionInstalled(extensionId: string): boolean;
  showExtensionMissing(): void;
  currentWorkspacePath(): string | undefined;
  reveal(sessionId: string): void | Promise<void>;
  openInWorktreeWindow(target: OpenChatSessionTarget): void | Promise<void>;
}

// Opens (or reveals) a ChatSession window through the Claude VS Code extension.
// A session resumes only within its own worktree — the extension runs
// `claude --resume <id>` in the current workspace folder, and Claude Code scopes
// sessions by project, so resuming one from another worktree would silently start
// a blank conversation. A session in the current worktree is revealed in place;
// one from another worktree opens that worktree's window and is resumed there
// (Deck queues the open so the target window picks it up). Without the extension
// there is nothing to hand off to, so nudge the user to install it.
export async function openChatSession(
  target: OpenChatSessionTarget,
  deps: OpenChatSessionDeps,
): Promise<void> {
  if (!deps.isExtensionInstalled(CLAUDE_EXTENSION_ID)) {
    deps.showExtensionMissing();
    return;
  }
  if (!isCurrentWorktree(target.worktreePath, deps.currentWorkspacePath())) {
    await deps.openInWorktreeWindow(target);
    return;
  }
  await deps.reveal(target.sessionId);
}

function isCurrentWorktree(worktreePath: string, currentWorkspacePath: string | undefined): boolean {
  if (currentWorkspacePath === undefined) return false;
  return path.resolve(worktreePath) === path.resolve(currentWorkspacePath);
}
