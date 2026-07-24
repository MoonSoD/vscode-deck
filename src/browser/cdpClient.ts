// The DevTools Protocol HTTP endpoints are Deck's list/observe/control channel
// for the DeckBrowser — the analog of `tmux list-sessions` for Terminals. We use
// only the plain `/json` HTTP endpoints (no WebSocket), which keeps CDP a simple
// request/response boundary, avoids a new WebSocket dependency, and matches
// ADR-0052's preference for polling over an event-stream client.
//
// Compatibility notes: recent Chrome requires PUT (not GET) for `/json/new` — we
// never open windows that way (we spawn `--app` processes), so it does not affect
// us. `--remote-allow-origins` is only needed for WebSocket CDP connections,
// which we also do not use. `/json/activate` and `/json/close` remain GET.

export interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
}

export interface CdpVersion {
  browser: string;
  webSocketDebuggerUrl?: string;
}

export interface CdpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export type CdpFetch = (url: string, init?: { method?: string }) => Promise<CdpResponse>;

const defaultFetch: CdpFetch = (url, init) =>
  globalThis.fetch(url, init) as unknown as Promise<CdpResponse>;

export class CdpClient {
  constructor(private readonly fetch: CdpFetch = defaultFetch) {}

  // The instance liveness probe: `undefined` means nothing is listening on the
  // debug port (the Worktree's Chrome instance is down).
  async version(port: number): Promise<CdpVersion | undefined> {
    const body = await this.getJson(port, '/json/version');
    if (!isRecord(body)) return undefined;
    return {
      browser: typeof body.Browser === 'string' ? body.Browser : '',
      ...(typeof body.webSocketDebuggerUrl === 'string'
        ? { webSocketDebuggerUrl: body.webSocketDebuggerUrl }
        : {}),
    };
  }

  async listTargets(port: number): Promise<CdpTarget[]> {
    const body = await this.getJson(port, '/json/list');
    if (!Array.isArray(body)) return [];
    return body.flatMap((entry) => {
      if (!isRecord(entry)) return [];
      if (typeof entry.id !== 'string' || typeof entry.url !== 'string') return [];
      return [{
        id: entry.id,
        url: entry.url,
        type: typeof entry.type === 'string' ? entry.type : '',
        title: typeof entry.title === 'string' ? entry.title : '',
      }];
    });
  }

  async activate(port: number, targetId: string): Promise<void> {
    await this.getVoid(port, `/json/activate/${targetId}`);
  }

  async close(port: number, targetId: string): Promise<void> {
    await this.getVoid(port, `/json/close/${targetId}`);
  }

  private async getJson(port: number, path: string): Promise<unknown> {
    try {
      const response = await this.fetch(this.endpoint(port, path));
      if (!response.ok) return undefined;
      return await response.json();
    } catch {
      return undefined;
    }
  }

  private async getVoid(port: number, path: string): Promise<void> {
    try {
      await this.fetch(this.endpoint(port, path));
    } catch {
      // Best-effort: activate/close failures are swallowed like the tmux CLI's.
    }
  }

  private endpoint(port: number, path: string): string {
    return `http://127.0.0.1:${port}${path}`;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The TCP port of a target's URL — how a PreviewWindow is matched to its CDP
// target, since each preview has a unique PreviewPort (robust to path redirects).
export function targetPort(url: string): string | undefined {
  try {
    return new URL(url).port;
  } catch {
    return undefined;
  }
}
