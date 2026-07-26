import * as vscode from 'vscode';
import {
  createAndOpenTerminal,
  type AddTerminalTmuxCli,
  type WorktreeNodeLike,
} from '../terminal/addTerminalCommand';
import { SessionUriCodec } from '../terminal/sessionUriCodec';
import type { PreviewDefinition } from './previewDefinition';

interface RunPreviewTmuxCli extends AddTerminalTmuxCli {
  sendCommandLine(session: string, command: string): Promise<void>;
}

export interface RunPreviewCommandOptions {
  resolvePreviews: (worktreePath: string) => Promise<PreviewDefinition[]>;
  resolvePreviewEnv?: (worktreePath: string) => Promise<Record<string, string>>;
  sessionUriCodec?: SessionUriCodec;
  refresh?: () => void;
  beforeCreate?: () => Promise<void>;
  pickPreview?: (previews: PreviewDefinition[]) => Promise<PreviewDefinition | undefined>;
  notifyNoRunnablePreviews?: () => void;
}

// The ▶ Run button on a Worktree row. Runs a preview's dev-server command in a
// fresh Deck Terminal (with the PreviewPort injected as env, so the server binds
// the port its window points at). One runnable preview → runs it; several → a
// Quick Pick. Only previews that declare a `command` are runnable. Once the
// server is up the BrowserPoll sees the port and the preview's row appears.
export class RunPreviewCommand {
  private readonly resolvePreviews: (worktreePath: string) => Promise<PreviewDefinition[]>;
  private readonly resolvePreviewEnv: (worktreePath: string) => Promise<Record<string, string>>;
  private readonly sessionUriCodec: SessionUriCodec;
  private readonly refresh: () => void;
  private readonly beforeCreate: () => Promise<void>;
  private readonly pickPreview: (previews: PreviewDefinition[]) => Promise<PreviewDefinition | undefined>;
  private readonly notifyNoRunnablePreviews: () => void;

  constructor(private readonly tmux: RunPreviewTmuxCli, options: RunPreviewCommandOptions) {
    this.resolvePreviews = options.resolvePreviews;
    this.resolvePreviewEnv = options.resolvePreviewEnv ?? (async () => ({}));
    this.sessionUriCodec = options.sessionUriCodec ?? new SessionUriCodec();
    this.refresh = options.refresh ?? (() => undefined);
    this.beforeCreate = options.beforeCreate ?? (() => Promise.resolve());
    this.pickPreview = options.pickPreview ?? defaultPickPreview;
    this.notifyNoRunnablePreviews = options.notifyNoRunnablePreviews ?? defaultNotifyNoRunnablePreviews;
  }

  async run(node: WorktreeNodeLike | undefined): Promise<void> {
    if (!node) return;

    const runnable = (await this.resolvePreviews(node.worktree.path)).filter(
      (preview) => preview.command !== undefined,
    );
    if (runnable.length === 0) {
      this.notifyNoRunnablePreviews();
      return;
    }

    const preview = runnable.length === 1 ? runnable[0] : await this.pickPreview(runnable);
    if (!preview || preview.command === undefined) return;

    await this.beforeCreate();
    const env = await this.resolvePreviewEnv(node.worktree.path);
    const session = await createAndOpenTerminal(this.tmux, node, this.sessionUriCodec, env);
    await this.tmux.sendCommandLine(session, preview.command);
    this.refresh();
  }
}

async function defaultPickPreview(previews: PreviewDefinition[]): Promise<PreviewDefinition | undefined> {
  const picked = await vscode.window.showQuickPick(
    previews.map((preview) => ({ label: preview.name, description: preview.command, preview })),
    { placeHolder: 'Run preview environment' },
  );
  return picked?.preview;
}

function defaultNotifyNoRunnablePreviews(): void {
  void vscode.window.showInformationMessage(
    'No runnable previews for this worktree. Add one with a "command" to deck.previews or .deck/previews.json.',
  );
}
