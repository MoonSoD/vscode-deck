import { join, resolve } from 'node:path';
import type { PreviewDefinition } from './previewDefinition';

// Every preview of a Worktree shares one slot, so a Worktree's ports are a
// predictable, consistent offset from each PreviewDefinition's base. Keeping the
// span narrow (100) keeps ports in a readable band per base; the trade-off is
// that two Worktrees can hash to the same slot (a dev server then fails to bind,
// which the user sees) — acceptable for a handful of concurrent Worktrees.
const SLOT_SPAN = 100;

// FNV-1a 32-bit — a small, stable string hash (no crypto needed). The PreviewPort
// and Chrome profile dir derive from it, so it must be pure and stable across
// runs and machines: that is what lets the dev server (env) and the PreviewWindow
// URL agree with no handshake.
function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// A Worktree's stable slot in [0, SLOT_SPAN).
export function worktreeSlot(worktreePath: string): number {
  return hash32(resolve(worktreePath)) % SLOT_SPAN;
}

// The deterministic PreviewPort for a (Worktree, PreviewDefinition).
export function previewPort(worktreePath: string, def: PreviewDefinition): number {
  return def.portBase + worktreeSlot(worktreePath);
}

// The URL a PreviewWindow loads. `localhost` (not `127.0.0.1`) to match the host
// dev servers print; CDP target matching normalises the two.
export function previewUrl(worktreePath: string, def: PreviewDefinition): string {
  return `http://localhost:${previewPort(worktreePath, def)}${def.path ?? '/'}`;
}

// The env vars Deck injects into a Worktree's Terminals so dev servers bind the
// same PreviewPorts the PreviewWindow URLs point at. Only previews that declare a
// portEnv contribute; if two share an env name, the last one wins.
export function previewEnv(
  worktreePath: string,
  previews: readonly PreviewDefinition[],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const def of previews) {
    if (def.portEnv === undefined) continue;
    env[def.portEnv] = String(previewPort(worktreePath, def));
  }
  return env;
}

// The isolated Chrome `--user-data-dir` for a Worktree, under Deck's machine-global
// runtime dir. Keyed by a hash of the resolved path (the raw path can contain
// spaces and separators), with the basename kept as a human-readable prefix.
export function previewProfileDir(deckDir: string, worktreePath: string): string {
  const resolved = resolve(worktreePath);
  const base = resolved.split('/').pop() || 'worktree';
  const safeBase = base.replace(/[^a-zA-Z0-9]/g, '-');
  const hex = hash32(resolved).toString(16).padStart(8, '0');
  return join(deckDir, 'chrome', `${safeBase}-${hex}`);
}
