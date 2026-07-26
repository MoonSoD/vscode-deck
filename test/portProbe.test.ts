import { createServer, type Server } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { isPortListening } from '../src/browser/portProbe';

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function listen(): Promise<number> {
  return new Promise((resolve) => {
    const server = createServer();
    servers.push(server);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : 0);
    });
  });
}

describe('isPortListening', () => {
  it('is true while a server is listening on the port', async () => {
    const port = await listen();
    expect(await isPortListening(port)).toBe(true);
  });

  it('is false once nothing is serving the port', async () => {
    const port = await listen();
    await new Promise<void>((resolve) => servers[0].close(() => resolve()));
    servers.splice(0);
    expect(await isPortListening(port, '127.0.0.1', 200)).toBe(false);
  });
});
