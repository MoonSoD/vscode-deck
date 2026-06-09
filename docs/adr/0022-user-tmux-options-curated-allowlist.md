# ADR-0022: User-customizable tmux options via a curated allowlist, not a passthrough

## Context

Deck runs its own isolated tmux server (DeckSocket, ADR-0008) configured by a
bundled `resources/deck.conf` the user never edits. Several of those settings
are load-bearing — `destroy-unattached off` (Terminals survive detach),
`status off` (no status bar in xterm.js), `prefix None`/`prefix2 None` plus the
`unbind -a` block (no keymaps hijack input), and the `@resurrect-*` keys
(TerminalSnapshot). If any of these flips, Deck's model breaks.

Users still want to tune the *cosmetic, safe* parts — first of all the window
name format (`automatic-rename-format`), which drives both the sidebar row and
the editor tab label. The question is how to let them, without handing them a
loaded gun pointed at the load-bearing options.

Alternatives considered:

- **A. Free-form passthrough** — a single `deck.tmuxConfig` string (or a sourced
  user file). Maximally flexible, but a user can trivially break Deck
  (`set -g status on`, rebind keys, `set -g destroy-unattached on`). Staying
  safe would mean sourcing it first and re-asserting every load-bearing option
  after — fragile, and still can't anticipate every dangerous option. Rejected.
- **B. Curated allowlist** — dedicated `deck.tmux.*` VS Code settings, one per
  vetted option, rendered into `deck.conf`. Dangerous options are simply not
  exposed. Selected. Narrow interface ("these N knobs"), the
  tmux-can-break-itself complexity stays hidden behind it.

## Decision

1. **Curated allowlist under `deck.tmux.*`.** Only options Deck has vetted as
   safe get a setting. No free-form passthrough, no sourcing the user's
   `~/.tmux.conf`. Load-bearing options remain Deck-owned and unreachable.

2. **v1 fields.**
   - `deck.tmux.automaticRenameFormat` → `automatic-rename-format`. Default
     `""` — empty emits no line, preserving tmux's built-in default (today's
     behavior). Non-empty is rendered and live-applied.
   - `deck.tmux.historyLimit` → `history-limit`. Default `50000`, lifted from
     the value hardcoded in `deck.conf` (ADR-0008 decision 11) so the setting
     becomes its single source of truth.

3. **Render + live-apply, running server is source of truth.** Values are
   rendered into `deck.conf` (so a fresh server — reboot/`kill-server` restore —
   boots correctly) *and* pushed live via `tmux set -g` to the DeckSocket on
   activation and on `onDidChangeConfiguration`. Clearing `automaticRenameFormat`
   back to empty actively unsets it live (`set -gu`) to restore the default.

4. **Sanitize structural hazards only.** A format that resolves to a value
   containing a newline manufactures phantom rows in the tab/newline-delimited
   `list-sessions` parse; a tab truncates the name. Reject newlines/tabs and
   safe-quote the value when writing `deck.conf`; on an invalid value, warn and
   fall back to the default. Legal-tmux-format validation is not attempted —
   tmux degrades a bogus format to literal text, which the user can see and fix.

## Consequences

- The two v1 fields differ on live-apply. `automatic-rename-format` is
  retroactive — one `set -g` re-titles every window on the next tick.
  `history-limit` is **not** — tmux applies it only to newly created
  windows/panes, so existing Terminals keep their old scrollback until
  recreated. Documented on the setting; no live-resize workaround.
- Adding a future safe field (e.g. another cosmetic option) is a small,
  pattern-following change: a new `deck.tmux.*` setting plus its render +
  live-apply wiring. The deliberate *no* — free-form passthrough — stays closed.

## Refines

- ADR-0008 decision 11: `deck.conf`'s `history-limit` is no longer a hardcoded
  literal; it is rendered from `deck.tmux.historyLimit` (default 50000).

## Status

Accepted.
