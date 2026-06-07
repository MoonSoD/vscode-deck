// Spike: tmux control mode (-C) as Deck terminal transport. Throwaway —
// findings recorded in README.md; the %output transcript is kept as a
// fixture for TmuxControlClient's tests.
//
// Questions answered:
//   Q1. Does every line of `seq 1 1000` arrive via %output (no drops)?
//   Q2. How large can a single `send-keys -H` command be (paste chunk size)?
//   Q3. Do raw SGR mouse bytes sent via `send-keys -H` reach the pane app?
//
// Run: node prototypes/control-mode/spike.mjs

import { spawn, execSync } from 'node:child_process';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';

const SOCKET = 'deckspike';
const CONF = new URL('../../resources/deck.conf', import.meta.url).pathname;

// --- minimal octal-escape decoder (the keeper; promote into TmuxControlClient) ---
function decodeOctalEscapes(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && /[0-7]/.test(s[i + 1])) {
      bytes.push(parseInt(s.slice(i + 1, i + 4), 8));
      i += 3;
    } else {
      // tmux passes printable ASCII through; high bytes are octal-escaped,
      // so charCodeAt here is always < 0x80.
      bytes.push(s.charCodeAt(i));
    }
  }
  return Buffer.from(bytes);
}

function hexEncode(buf) {
  return [...buf].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

const transcript = [];

function startClient() {
  const child = spawn('tmux', ['-C', '-L', SOCKET, '-f', CONF, 'new-session', '-A', '-s', 'spike'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const output = []; // decoded %output payloads, in order
  let buf = '';
  const waiters = [];
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('latin1');
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      transcript.push(line);
      if (line.startsWith('%error') || line.includes('usage:') || line.includes('too many')) {
        console.log('REPLY-ERR:', line);
      }
      if (line.startsWith('%output ')) {
        const payload = line.slice(line.indexOf(' ', 8) + 1);
        output.push(decodeOctalEscapes(payload));
      }
      for (const w of waiters) w(line);
    }
  });
  const send = (cmd) => child.stdin.write(cmd + '\n');
  const waitFor = (pred, timeoutMs = 10000) =>
    new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timeout waiting: ${pred}`)), timeoutMs);
      waiters.push((line) => {
        if (pred(line)) {
          clearTimeout(t);
          resolve(line);
        }
      });
    });
  return { child, send, waitFor, output };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = async (output, quietMs = 700, maxMs = 15000) => {
  // wait until no new %output for quietMs
  let last = -1;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    if (output.length === last) return;
    last = output.length;
    await sleep(quietMs);
  }
};

try {
  execSync(`tmux -L ${SOCKET} kill-server 2>/dev/null || true`, { shell: '/bin/sh' });

  const { child, send, waitFor, output } = startClient();
  await waitFor((l) => l.startsWith('%session-changed'));
  send("list-panes -t spike -F '#{pane_id}'");
  await sleep(300);
  const paneId = transcript.filter((l) => /^%\d|^%%/.test(l) === false && /^%\d+$/.test(l)).at(-1)
    ?? transcript.find((l) => /^%\d+$/.test(l));
  console.log(`pane: ${paneId}`);
  await settle(output); // let shell prompt noise flush
  output.length = 0;

  // --- Q1: seq completeness ---
  send(`send-keys -t ${paneId} -H ${hexEncode(Buffer.from('seq 1 1000\r'))}`);
  await settle(output);
  const text = Buffer.concat(output).toString('utf8').replace(/\r/g, '')
    // strip ANSI/OSC/title escapes so `\n<n>\n` matching is reliable
    .replace(/(\[[0-9;?]*[a-zA-Z]|\][^]*(|\\)|k[^]*\\|[>=])/g, '');
  const missing = [];
  for (let n = 1; n <= 1000; n++) if (!text.includes(`\n${n}\n`) && !text.startsWith(`${n}\n`)) missing.push(n);
  console.log(`Q1 seq 1..1000 via [percent]output: missing=${missing.length} ${JSON.stringify(missing.slice(0, 10))}`);
  if (missing.length) console.log('Q1 head of text:', JSON.stringify(text.slice(0, 120)));

  // helper: raw-mode exact-byte sink, sidesteps canonical-mode tty buffering
  const recvExact = async (file, payload, settleMs) => {
    rmSync(file, { force: true });
    send(`send-keys -t ${paneId} -H ${hexEncode(Buffer.from(`stty raw -echo; head -c ${payload.length} > ${file}; stty sane\r`))}`);
    await sleep(500);
    send(`send-keys -t ${paneId} -H ${hexEncode(payload)}`);
    await sleep(settleMs);
    try { return readFileSync(file); } catch { return Buffer.alloc(0); }
  };

  // --- Q2: send-keys -H size limit (paste chunking) ---
  for (const size of [1024, 8 * 1024, 16 * 1024, 24 * 1024, 32 * 1024, 64 * 1024]) {
    const got = await recvExact('/tmp/spike-paste.out', Buffer.from('x'.repeat(size)), 2000);
    console.log(`Q2 send-keys -H ${size} bytes: pane received ${got.length} ${got.length === size ? 'OK' : 'MISMATCH'}`);
    if (got.length !== size) {
      // failed send leaves `head -c <size>` starving — kill it so the shell recovers
      execSync(`pkill -f 'head -c ${size}' || true`, { shell: '/bin/sh' });
      await sleep(500);
    }
  }

  // --- Q2b: unicode/emoji through -H ---
  const uni = Buffer.from('héllo wörld 日本語 🚀🎉\n', 'utf8');
  const uniGot = await recvExact('/tmp/spike-uni.out', uni, 800);
  console.log(`Q2b unicode round-trip: ${uniGot.equals(uni) ? 'OK' : `MISMATCH ${JSON.stringify(uniGot.toString('utf8'))}`}`);

  // --- Q3: SGR mouse bytes reach the pane app ---
  const mouse = Buffer.from('\x1b[<0;10;10M\x1b[<0;10;10m');
  const mouseGot = await recvExact('/tmp/spike-mouse.out', mouse, 800);
  console.log(`Q3 SGR mouse passthrough: ${mouseGot.equals(mouse) ? 'OK' : `FAIL ${JSON.stringify(mouseGot.toString())}`}`);

  // --- save transcript fixture ---
  writeFileSync(new URL('./transcript.txt', import.meta.url), transcript.join('\n'));
  console.log(`transcript: ${transcript.length} lines saved`);

  send('kill-server');
  await new Promise((r) => child.on('exit', r));
} finally {
  execSync(`tmux -L ${SOCKET} kill-server 2>/dev/null || true`, { shell: '/bin/sh' });
}
