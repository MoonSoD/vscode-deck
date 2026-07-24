import { describe, expect, it, vi } from 'vitest';
import { CdpClient, type CdpFetch, type CdpResponse } from '../src/browser/cdpClient';

function ok(body: unknown): CdpResponse {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
}

describe('CdpClient.version', () => {
  it('reports the browser and debugger url when the instance is up', async () => {
    const fetch: CdpFetch = vi.fn(async () =>
      ok({ Browser: 'Chrome/120.0', webSocketDebuggerUrl: 'ws://127.0.0.1:9315/devtools/browser/x' }),
    );
    await expect(new CdpClient(fetch).version(9315)).resolves.toEqual({
      browser: 'Chrome/120.0',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9315/devtools/browser/x',
    });
    expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:9315/json/version');
  });

  it('is undefined when the port refuses the connection', async () => {
    const fetch: CdpFetch = async () => { throw new Error('ECONNREFUSED'); };
    await expect(new CdpClient(fetch).version(9315)).resolves.toBeUndefined();
  });

  it('is undefined on a non-ok response', async () => {
    const fetch: CdpFetch = async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => '' });
    await expect(new CdpClient(fetch).version(9315)).resolves.toBeUndefined();
  });
});

describe('CdpClient.listTargets', () => {
  it('parses well-formed targets and drops malformed entries', async () => {
    const fetch: CdpFetch = async () => ok([
      { id: 'A', type: 'page', title: 'App', url: 'http://localhost:3042/' },
      { id: 'B', title: 'no url' },
      'garbage',
    ]);
    await expect(new CdpClient(fetch).listTargets(9315)).resolves.toEqual([
      { id: 'A', type: 'page', title: 'App', url: 'http://localhost:3042/' },
    ]);
  });

  it('is an empty list when the endpoint is unreachable', async () => {
    const fetch: CdpFetch = async () => { throw new Error('down'); };
    await expect(new CdpClient(fetch).listTargets(9315)).resolves.toEqual([]);
  });
});

describe('CdpClient.activate / close', () => {
  it('hits the activate and close endpoints for a target', async () => {
    const fetch = vi.fn<CdpFetch>(async () => ok({}));
    const client = new CdpClient(fetch);
    await client.activate(9315, 'ABC');
    await client.close(9315, 'ABC');
    expect(fetch).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:9315/json/activate/ABC');
    expect(fetch).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:9315/json/close/ABC');
  });
});
