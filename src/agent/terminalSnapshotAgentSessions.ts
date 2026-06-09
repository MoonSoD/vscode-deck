import { readFile, writeFile } from 'node:fs/promises';
import type { AgentSidecarStore } from './agentSidecarStore';
import { SnapshotRewriter } from './snapshotRewriter';

export async function rewriteTerminalSnapshotAgentSessions(
  snapshotPath: string,
  sidecarStore: AgentSidecarStore,
  rewriter = new SnapshotRewriter(),
): Promise<void> {
  let snapshotText: string;
  try {
    snapshotText = await readFile(snapshotPath, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return;
    throw error;
  }

  const rewritten = rewriter.rewrite(snapshotText, await sidecarStore.readAll());
  if (rewritten !== snapshotText) {
    await writeFile(snapshotPath, rewritten, 'utf8');
  }
}
