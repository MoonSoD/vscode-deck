# ADR-0041: Idle AgentTitle sync via a dedicated label poll

## Context

ADR-0039 surfaces the AgentTitle (the agent's TUI-set `#{pane_title}`,
glyph-stripped) as the Terminal row/tab label, and claimed refresh "rides the
status watcher" — that the hook's status writes "coincide with when the agent
rewrites its title, so the row is live without polling." **Live QA proved that
wrong.** Two gaps:

1. **The status watcher doesn't fire often enough on its own.** The #129
   implementation only made *active-work* titles refresh by widening
   `sameStatus` so every `inProgress` `statusAt` bump (one per tool call) counts
   as a change — reintroducing the per-tool-call tree re-render an earlier
   optimization deliberately removed. A churny hack, flagged in review.

2. **Idle title changes never sync.** When the agent is idle (`/rename`, or a
   re-summarize between turns) it rewrites `pane_title` with **no status write**
   — so nothing fires, and the label stays stale until some incidental refresh.
   Observed directly: `/rename` while idle took "some time to sync."

The root cause is structural: **tmux control mode emits no `%pane-title-changed`
event.** A title change is invisible to Deck unless Deck either (a) scans the
pane's byte stream for the OSC title sequence, or (b) polls `pane_title`. Deck's
`TmuxControlClient` (and its `%output` stream) is created **per open editor tab**
(`tmux -C new-session -A -s <thisSession>`, one per `TerminalTransport`), so a
byte-stream scanner can only see titles for terminals **with an open tab** — not
closed-tab or foreign-Worktree agent rows, whose label comes only from the
one-shot `list-sessions` at tree-refresh time.

Peer survey (`~/code`): terminal-emulator tools (superset, herdr, tuicommander)
scan OSC from the PTY byte stream; the **tmux-based** tools — the true analogues
— **poll** (`amux`: refresh loop with TTLs; `agent-deck`: "one `list-panes` per
tick"). And Deck is **already not poll-free**: the AgentExitSweep is a 5 s
`setTimeout` poll loop (`agentExitSweep.ts`; ADR-0030/0031/0037). The "Deck is
event-driven, no poll" line was a *considered-option aside in ADR-0023*, written
before the sweep existed.

## Decision

Add a **dedicated, read-only label poll** (`AgentTitlePoll`) as the single
freshness driver for Terminal labels, and **revert the #129 status-heartbeat
hack**.

1. **A dedicated poll, not the `%output` scanner.** The scanner can't serve
   closed-tab/foreign rows (no per-row stream), and would re-extract a title
   tmux already parsed. The poll does **one global `list-sessions`** (which
   already returns `#{pane_title}` per ADR-0039) per tick and covers every row
   uniformly.

2. **Diff the resolved label, not raw `pane_title`.** Fire only when some
   session's `resolveTerminalLabel(windowName, paneTitle)` (ADR-0039) changed
   since the last tick. This filters by construction: a plain shell's `cd`
   churns `pane_title` but its label is `windowName` (unchanged → no fire),
   while it still catches `zsh → claude` on `SessionStart` for streamless
   foreign rows.

3. **~2 s cadence.** Slow enough to be cheap (one subprocess), fast enough that
   the tab you just renamed feels responsive. Title freshness now comes from the
   poll for **both** idle and active work, so it need not match the sweep's 5 s.

4. **Lifecycle: agent-present + focus-gated, no lock.** Runs only while ≥1 agent
   Terminal exists; pauses when the window is unfocused, with one **catch-up
   poll on refocus**. It is read-only (`list-sessions` + a local refresh), so —
   unlike the sweep, which mutates sidecars and needs the ADR-0034/0036 file
   lock — each window polls independently with no serialization. Strictly more
   conservative than the always-on sweep.

5. **`onChange` drives both surfaces; revert the heartbeat.** The poll fires
   `refreshTree` (rows) and `terminalEditorProvider.refreshTitles` (open tabs).
   With the poll owning label freshness, `sameStatus` is **reverted** to ignore
   `inProgress` `statusAt` bumps (restoring the optimization, killing the
   per-tool-call churn), and the tab title moves **off** the
   `agentStatuses.onDidChange` subscription #129 added **onto** the poll. Final
   separation of concerns:
   - **AgentTitlePoll** → row + tab **labels** (resolved-label changes).
   - **status watcher** → **icon / notifications / decorations** (status
     *transitions*, which the original `sameStatus` already detects).
   - **`%window-renamed`** → still refreshes (foreground-command changes,
     agent rename on `SessionStart`).

## Considered Options

- **`%output` OSC scanner (superset/herdr style).** Rejected: only sees
  open-tab terminals (per-tab stream), leaving closed-tab/foreign rows stale;
  adds a byte-stream detector + debounce to track a title tmux has already
  parsed into `pane_title`. Build X in the ADR-0039 grill.
- **Piggyback the sweep's 5 s tick.** Rejected: muddies the sweep's sole
  responsibility (ADR-0033, remove dead sidecars) and couples cosmetic refresh
  to liveness cadence. A dedicated poll keeps each single-purpose.
- **Keep #129's status-heartbeat and layer the poll on top.** Rejected:
  redundant fires and leaves the per-tool-call tree re-render churn in place;
  the poll subsumes it cleanly.
- **Status quo (accept idle staleness).** Rejected: the `/rename`-while-idle lag
  is the concrete complaint this resolves.
- **Cache title at creation.** N/A — the title is inherently live (see ADR-0040's
  identical rejection for branch).

## Consequences

- **Corrects ADR-0039.** Its "the row is live without polling … status writes
  coincide with title changes" is false for idle changes and was only
  approximated for active work by a hack. Label freshness is now the poll's job;
  the status watcher returns to its tuned role.
- **Deck gains a second poll loop** beside the sweep — but read-only,
  focus-gated, and agent-gated, so it cannot wake an idle machine on its own.
- **Steady-state idle cost: one `list-sessions` per ~2 s** (per focused window
  with agents). The expensive tree/tab refresh runs only on an actual
  resolved-label change.
- **Bounded idle lag (~2 s)** replaces "until next incidental refresh."
  Closed-tab/foreign rows are now covered too — the scanner could not.
- Complements ADR-0040: the notifier resolves the AgentTitle live on demand at
  notify time; this keeps the *displayed* labels live continuously. Same
  `resolveTerminalLabel`, different trigger.

## Status

Accepted.
