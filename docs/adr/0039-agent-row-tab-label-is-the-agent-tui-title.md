# ADR-0039: The agent row/tab label is the agent's TUI title; the window name stays the identity

## Context

ADR-0023 §1 named an agent's tmux window with the agent identity (`claude` /
`codex`) and **nothing more**, deliberately scoping status and any per-task
detail out of the name. The `#{window_name}` then drives **both** the sidebar
row label and the editor tab title (`tmuxCli.listSessions`,
`describeTerminalTreeItem`, `terminalEditorProvider.applyTitle`).

The cost in practice: N agents across N Worktrees are **indistinguishable** —
every row and tab reads `claude`. The disambiguating information the user wants
already exists, set by the agent's own TUI via an OSC title escape, surfaced by
tmux as `#{pane_title}` (distinct from `#{window_name}`, which
`automatic-rename` ties to `#{pane_current_command}` — the useless version
string per ADR-0023 §Context). Empirically:

- **Claude** sets `pane_title` to `<glyph> <task summary>` — e.g.
  `✳ fix-dlq-requeue-uploads-deadline`. The leading glyph encodes status: `✳`
  (U+2733, idle/done) or an **animating** Braille spinner (U+2800–28FF, working).
- **Codex** sets `pane_title` from a user-configurable item list
  (`/title`); the default is `activity + project-name`, where `activity` is an
  animating Braille spinner (`status_surfaces.rs` `TERMINAL_TITLE_SPINNER_FRAMES`)
  and `project-name` is the worktree basename. A blocked Codex prefixes the
  **ASCII** text `[ ! ] Action Required`.

Peer survey (all in `~/code`): **superset** (own VT) and **amux** (tmux) read
the OSC title, strip the leading status glyphs, and display the rest;
**agent-deck** (tmux, closest analogue) keeps a Deck/user-owned name and reads
the title *only* to drive a status badge; **tuicommander** parses the raw output
stream per-agent; **herdr** embeds a VT. Two lessons: **nobody renders the title
verbatim** (raw spinner glyphs "freeze on the last frame" once the spinner
stops — superset's comment), and the **glyph strip is a known bounded transform**
(leading `[⠀-⣿✀-➿]` — Braille + Dingbats), not an open-ended
parse of an opaque format.

## Decision

Surface the **AgentTitle** — `stripGlyphs(pane_title)` — as the agent Terminal's
row and tab label, while the **window name stays the agent identity**.

1. **The window name is unchanged.** The hook still `rename-window`s to `$agent`
   on `SessionStart`/`UserPromptSubmit`. `#{window_name}` remains `claude`/`codex`,
   so the agent **icon** (`agentIconResolver`, keyed on the name) keeps working
   with zero change — including the pre-first-prompt / just-resumed window, where
   no AgentStatus file exists yet and the name is the only identity source.

2. **The label is title-derived and gated to agents.**
   `resolveTerminalLabel(windowName, paneTitle)`: when `isAgent(windowName)`,
   the label is `stripGlyphs(paneTitle)` (leading `[⠀-⣿✀-➿\s]+`,
   the range validated against both agents' source), falling back to `windowName`
   when the stripped result is empty. For non-agent terminals the label stays
   `windowName` — **the gate is essential**: read unconditionally, every plain
   shell row would become its shell-set title (e.g. `:/Users/.../repo`).

3. **The strip happens in TypeScript**, once, shared by the row and the tab —
   not in the hook (POSIX `sh` Unicode-range stripping is fragile) and not by
   renaming the window to the title (that would force the icon's identity off the
   name — see Build X below).

4. **Refresh rides the status watcher, not a title event.** tmux control mode
   emits **no `%pane-title-changed`**. The tree already re-reads `listSessions`
   on every `agentStatuses.onDidChange` (`repositoryTree.ts`), which fires on
   every hook status write — and those writes **coincide** with when the agent
   rewrites its title (`UserPromptSubmit` / tool use), so the row is live without
   polling. The tab's `applyTitle()` gains the same `agentStatuses.onDidChange`
   trigger (session-filtered) alongside the existing `onRename`.

   **Corrected by ADR-0041:** this proved false for **idle** title changes
   (`/rename` with no status write) and was only approximated for active work by
   a churny `sameStatus` hack. Label freshness moves to a dedicated read-only
   label poll (`AgentTitlePoll`); the status watcher reverts to driving
   icon/notifications/decorations on real transitions.

## Considered Options

- **Build X — rename the window to the title** (so it changes each turn →
  `%window-renamed` → the existing refresh path drives both surfaces). Rejected:
  `#{window_name}` would no longer be `claude`/`codex`, so the icon's identity
  source vanishes for the pre-first-prompt / just-resumed window and would have
  to be **re-homed onto the sidecar** (`agentSidecarStore`, not currently a tree
  dependency); the glyph strip would also move into the hook's `sh`. More blast
  radius for a refresh the status watcher already provides.
- **Render `pane_title` verbatim** — rejected: the animating spinner glyph
  churns and freezes on its last frame (the failure superset documents); no peer
  does this.
- **Live `%output` OSC scanner in `TmuxControlClient`** (superset's approach) —
  rejected for v1: reintroduces a byte scanner and a spinner-debounce just to
  track a glyph we strip anyway; the status watcher is enough.
- **Codex-specific guard** (suppress the label when it equals the worktree
  basename) — rejected: an extra heuristic to hide a redundancy the icon already
  resolves; "show what the TUI sets" is simpler and honest.

## Consequences

- **Amends ADR-0023 §1.** The window name still carries identity (and drives the
  icon + one `%window-renamed`), but it is no longer what the user reads — the
  AgentTitle is. ADR-0023's teardown (§3) now also benefits: when Claude exits,
  `SessionEnd` restores `automatic-rename`, the name reverts to `zsh`, `isAgent`
  goes false, and the label drops the stale summary **for free** — no new
  teardown code.
- **Accepted Codex-only cosmetics**, all consistent with the ADR-0023 §3
  asymmetry: (a) idle Codex shows its `project-name` default (the worktree
  basename — redundant with the parent row, but the icon still identifies it);
  (b) a blocked Codex's label briefly reads `[ ! ] Action Required …` (ASCII, not
  glyph-stripped, duplicates Deck's `needsInput` icon); (c) Codex stays
  mislabeled after exit (no `SessionEnd`) until the sweep removes it or the shell
  overwrites the title.
- **New dependency: the editor provider observes AgentStatus** to refresh the tab
  title. Small and one-directional.
- **The label is only as fresh as the status-write cadence.** Between status
  writes the title is stale; in practice the cadence tracks title changes, so
  this is unobservable for the common case (a mid-tool title change with no
  status write is the worst case, and rare).

## Status

Accepted.
