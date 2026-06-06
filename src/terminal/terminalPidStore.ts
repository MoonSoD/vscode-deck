export const TERMINAL_PID_KEY = 'deck.terminalPids';
export const TERMINAL_PID_SCHEMA_VERSION = 1;

interface TerminalPidStored {
  schemaVersion: number;
  bySession: Record<string, number>;
}

interface MementoLike {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): Thenable<void>;
}

export class TerminalPidStore {
  constructor(private readonly memento: MementoLike) {}

  get(sessionName: string): number | undefined {
    return this.read().bySession[sessionName];
  }

  async set(sessionName: string, pid: number): Promise<void> {
    const stored = this.read();
    await this.write({
      ...stored,
      bySession: {
        ...stored.bySession,
        [sessionName]: pid,
      },
    });
  }

  async remove(sessionName: string): Promise<void> {
    const stored = this.read();
    if (!(sessionName in stored.bySession)) return;
    const { [sessionName]: _removed, ...bySession } = stored.bySession;
    await this.write({ ...stored, bySession });
  }

  async prune(liveSessionNames: readonly string[]): Promise<void> {
    const stored = this.read();
    const live = new Set(liveSessionNames);
    const bySession = Object.fromEntries(
      Object.entries(stored.bySession).filter(([sessionName]) => live.has(sessionName)),
    );
    if (Object.keys(bySession).length === Object.keys(stored.bySession).length) return;
    await this.write({ ...stored, bySession });
  }

  private read(): TerminalPidStored {
    const empty = { schemaVersion: TERMINAL_PID_SCHEMA_VERSION, bySession: {} };
    const raw = this.memento.get<TerminalPidStored>(TERMINAL_PID_KEY, empty);
    if (raw.schemaVersion !== TERMINAL_PID_SCHEMA_VERSION) return empty;
    return raw;
  }

  private async write(value: TerminalPidStored): Promise<void> {
    await this.memento.update(TERMINAL_PID_KEY, value);
  }
}
