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

2. **v1 field — `automatic-rename-format` only.**
   - `deck.tmux.automaticRenameFormat` → `automatic-rename-format`. Default
     `""` — empty emits no line, preserving tmux's built-in default (today's
     behavior). Non-empty is rendered and live-applied.
   - `history-limit` was scoped in but **dropped before shipping** — see the
     Consequences note. `deck.conf` keeps its hardcoded `50000`.

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

- `automatic-rename-format` is retroactive *per window*: a `set -g` re-titles a
  window the next time tmux recomputes its name — which happens on pane
  **activity** (output) or a foreground-command change, not on a global tick.
  Idle windows keep their old name until their next activity. There is no clean
  tmux command to force-recompute all names without injecting keystrokes, so
  this lazy refresh is accepted, not worked around.
- **`history-limit` was dropped before shipping.** Under control mode
  (ADR-0012) the *visible* scrollback is xterm.js's buffer (hardcoded `5000`,
  with the reattach seed capped to match); tmux's `history-limit` governs only
  tmux's internal pane history, which Deck reads via `capture-pane` for the
  reload/reboot seed. So a `historyLimit` setting could not raise visible
  scrollback (xterm caps it), its proposed `50000` default already exceeded the
  `5000` cap (inert), and lowering it would only *shrink* restored scrollback —
  a knob that is inert at its default and harmful when changed. Exposing it
  would not satisfy "tune my scrollback." Genuine scrollback control would have
  to drive xterm's `scrollback` + the seed + tmux `history-limit` together (a
  larger change with a real per-terminal memory tradeoff); deferred to its own
  feature rather than shipped as a misleading tmux passthrough.
- Adding a future safe field is a small, pattern-following change: a new
  `deck.tmux.*` setting plus its render + live-apply wiring. The deliberate
  *no* — free-form passthrough — stays closed. The `history-limit` episode is
  the reminder that "safe to set on tmux" is not the same as "meaningful given
  Deck's control-mode rendering" — vet the *observable effect*, not just safety.

## Status

Accepted.
