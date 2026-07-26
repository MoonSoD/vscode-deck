import { connect } from 'node:net';

// Is something serving on this local port right now? A PreviewWindow's ON state
// is "its dev server is up", detected by a cheap TCP connect to the deterministic
// PreviewPort — no dependency on the browser being open. Resolves false on
// refusal or timeout; never rejects.
export function isPortListening(port: number, host = '127.0.0.1', timeoutMs = 400): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ port, host });
    let settled = false;
    const finish = (listening: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}
