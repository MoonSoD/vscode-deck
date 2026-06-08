import { cpSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Webview assets must ship inside the .vsix. node_modules is excluded by
// .vscodeignore (and exposing it via localResourceRoots is discouraged), so
// the xterm UMD bundles the terminal webview loads via <script> are copied
// into dist/media at build time. Keep this list in sync with the
// asWebviewUri calls in terminalEditorProvider.ts.
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'dist', 'media');

const assets = [
  '@xterm/xterm/lib/xterm.js',
  '@xterm/xterm/css/xterm.css',
  '@xterm/addon-fit/lib/addon-fit.js',
  '@xterm/addon-web-links/lib/addon-web-links.js',
  '@xterm/addon-search/lib/addon-search.js',
];

mkdirSync(dest, { recursive: true });
for (const asset of assets) {
  const from = join(root, 'node_modules', asset);
  const to = join(dest, asset.split('/').pop());
  cpSync(from, to);
}
