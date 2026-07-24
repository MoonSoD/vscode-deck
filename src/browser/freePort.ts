import { createServer } from 'node:net';

// Ask the OS for a free TCP port by binding to 0 and reading it back. Used to
// allocate a Chrome `--remote-debugging-port` on a Worktree's first launch; the
// chosen port is then persisted in the BrowserStateStore so it stays stable for
// that Worktree's instance.
export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}
