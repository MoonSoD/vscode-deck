import { TERMINAL_SNAPSHOT_ANCHOR_SESSION } from './terminalSnapshotRuntime';

export type DeckSocketState =
  | { kind: 'down' }
  | { kind: 'bare' }
  | { kind: 'restoring'; done: Promise<void> }
  | RestoredDeckSocketState;

export interface RestoredDeckSocketState {
  kind: 'restored';
  sessions: ReadonlySet<string>;
}

export interface RestoreCoordinatorDeps {
  listSessions(): Promise<ReadonlyArray<{ sessionName: string }>>;
  restore(): Promise<unknown>;
  restoreLock?: {
    acquireBlocking(): Promise<boolean>;
    release(): Promise<void>;
  };
}

export interface RestoreCoordinator {
  classify(): Promise<DeckSocketState>;
  ensureRestored(): Promise<DeckSocketState>;
}

export function createRestoreCoordinator(deps: RestoreCoordinatorDeps): RestoreCoordinator {
  let inFlight: Promise<void> | undefined;
  // Sticks once a restore attempt finishes and the DeckSocket is still
  // down/bare afterward — an empty snapshot legitimately restores nothing,
  // and without this a caller that re-invokes ensureRestored() on every tick
  // (e.g. a tree refresh across many worktree rows) would re-run the full
  // anchor/restore/kill-anchor cycle forever. Cleared the moment real
  // sessions are observed, so a later DeckSocket death still restores again.
  let attemptedWithoutRestoring = false;

  const inspect = async (): Promise<DeckSocketState> => {
    const sessions = await deps.listSessions();
    if (sessions.length === 0) return { kind: 'down' };

    const realSessions = new Set(
      sessions
        .map((session) => session.sessionName)
        .filter((sessionName) => sessionName !== TERMINAL_SNAPSHOT_ANCHOR_SESSION),
    );
    if (realSessions.size === 0) return { kind: 'bare' };

    return { kind: 'restored', sessions: realSessions };
  };

  const classify = async (): Promise<DeckSocketState> => {
    if (inFlight) return { kind: 'restoring', done: inFlight };
    return inspect();
  };

  const guardedRestore = async (): Promise<void> => {
    const locked = (await deps.restoreLock?.acquireBlocking()) ?? false;
    try {
      if ((await inspect()).kind === 'restored') return;
      await deps.restore();
    } finally {
      if (locked) await deps.restoreLock?.release();
    }
  };

  const ensureRestored = async (): Promise<DeckSocketState> => {
    const state = await classify();
    switch (state.kind) {
      case 'restored':
        attemptedWithoutRestoring = false;
        return state;
      case 'restoring':
        await state.done;
        return classify();
      case 'down':
      case 'bare':
        if (inFlight) {
          await inFlight;
          return classify();
        }
        if (attemptedWithoutRestoring) return state;
        attemptedWithoutRestoring = true;
        inFlight = guardedRestore()
          .then(() => undefined)
          .finally(() => {
            inFlight = undefined;
          });
        await inFlight;
        return classify();
    }
  };

  return { classify, ensureRestored };
}
