export interface RestoreGateDeps {
  isServerRunning(): Promise<boolean>;
  restore(): Promise<unknown>;
}

// Gates terminal reattaches on a TerminalSnapshot restore. When the DeckSocket
// is alive the reattach proceeds immediately (bind to the existing session);
// when it's dead — reboot, or a crash / manual kill-server while VS Code stays
// open — restore runs first, so the reattach binds to the restored session
// instead of resurrecting it blank (which would then be saved over the good
// snapshot). Dynamic, not a one-shot: it re-restores on every death. Concurrent
// reattaches after a death share one in-flight restore.
export function createRestoreGate(deps: RestoreGateDeps): () => Promise<void> {
  let inFlight: Promise<void> | undefined;
  return async () => {
    if (await deps.isServerRunning()) return;
    if (!inFlight) {
      inFlight = deps
        .restore()
        .then(() => undefined)
        .finally(() => {
          inFlight = undefined;
        });
    }
    await inFlight;
  };
}
