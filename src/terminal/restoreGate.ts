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
}

export interface RestoreCoordinator {
  classify(): Promise<DeckSocketState>;
  ensureRestored(): Promise<DeckSocketState>;
}

export function createRestoreCoordinator(deps: RestoreCoordinatorDeps): RestoreCoordinator {
  let inFlight: Promise<void> | undefined;

  const classify = async (): Promise<DeckSocketState> => {
    if (inFlight) return { kind: 'restoring', done: inFlight };

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

  const ensureRestored = async (): Promise<DeckSocketState> => {
    const state = await classify();
    switch (state.kind) {
      case 'restored':
        return state;
      case 'restoring':
        await state.done;
        return classify();
      case 'down':
      case 'bare':
        if (!inFlight) {
          inFlight = deps
            .restore()
            .then(() => undefined)
            .finally(() => {
              inFlight = undefined;
            });
        }
        await inFlight;
        return classify();
    }
  };

  return { classify, ensureRestored };
}
