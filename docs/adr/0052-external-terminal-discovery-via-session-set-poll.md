# ADR-0052: External Terminal discovery via session-set poll, not control-mode events

## Context

A process outside Deck can create a Terminal: `tmux -L deck new-session` with
Deck's name grammar puts a session on the DeckSocket that `getTerminalChildren`
lists like any other (ADR-0014: tmux is the source of truth, listed live on
every render). But nothing *triggers* that render. Every terminal-tree refresh
driver is extension-internal — Deck's own commands, view visibility, workspace
changes — except ExternalGitWatch, which fires on the git half of the flow
only. The observed failure: an agent runs `git worktree add` then creates two
sessions; the git watch refreshes ~250ms after the worktree add, renders the
new Worktree with the zero sessions tmux has *at that instant*, and nothing
ever refires. The Worktree appears; its Terminals need a manual Deck: Refresh.

The 2s AgentTitlePoll (ADR-0041) sees the new sessions every tick but was
built to swallow them twice over: it reports only sessions whose label changed
since a *previous* tick (`previousLabel !== undefined` — a first sighting is
recorded silently), and its listener is the targeted relabel path (ADR-0046),
which skips any session with no rendered row (`if (!node) continue`). Both
gates exist because ADR-0046 reserved the poll for single-row label updates
and whole-tree fires for "discrete structural events."

External Terminal creation is now a supported contract, symmetric with
ExternalGitWatch's coverage of external worktrees: CONTEXT.md
**ExternalTerminalWatch**. Deck needs a discovery mechanism.

## Decision

**The poll discovers; a session-set change is a structural event.**

1. **Session-set diff in the poll.** Each tick already holds the full live
   session list. The poll additionally diffs the *set of session names*
   against the previous tick; any addition or removal fires one whole-tree
   `refreshTree()`. This is exactly ADR-0046's taxonomy: a set change is a
   discrete structural event (a row exists or it doesn't), so the whole-tree
   fire — with its async re-resolve — is the correct, cheap path. Label churn
   stays on the targeted relabel path; the two facets share one
   `list-sessions` call.

2. **The first tick is a silent baseline.** On start the poll records the set
   without firing — otherwise every activation would trigger a redundant
   refresh. The existing `labels` map keys already are the previous-tick set.

3. **The poll always reschedules while focused.** The old stop-gate
   (no agent sessions → stop polling, ADR-0041 §4's economy) is removed:
   discovery needs ticks even with zero agents running. The price is one
   `tmux list-sessions` every 2s while the window is focused.

4. **Refocus refreshes.** Sessions created while the window is unfocused
   (the poll is suspended) are caught by a `refreshTree()` on window-focus
   regain — the moment the user can first see the tree again.

5. **Rename: AgentTitlePoll → TerminalPoll.** Titles are now one facet of
   observing Terminals; the name follows the widened responsibility
   (CONTEXT.md **TerminalPoll**).

## Rejected: a control-mode `%sessions-changed` client

tmux control mode does emit `%sessions-changed` — the event-driven answer.
But a control client must *attach to a session*, and with zero Terminals
there is nothing to attach to: Deck would need a persistent hidden
housekeeping session, which leaks into everything that enumerates the
DeckSocket — session listing, TerminalSnapshot capture/restore, DeckSocket
recovery — three of the most delicate subsystems, plus a reconnect lifecycle
after `kill-server`/reboot. All to improve ≤2s latency to ~instant, below
human timescales for "an agent elsewhere made a terminal."

**Revisit trigger:** if the 2s latency ever matters (or an always-on control
client exists for other reasons), the event client slots in behind the same
`refreshTree()` seam with no model change.

## Consequences

- External `tmux kill-session` is symmetric: the row clears within ≤2s. Agent
  status hygiene needs no new path — the set-diff's `refreshTree()` already
  wakes AgentExitSweep, whose liveness probe reaps the dead session's sidecar
  and status.
- A focused idle window now runs `list-sessions` every 2s forever (was: poll
  stopped with no agents). Accepted as one cheap process spawn.
- A *visible but unfocused* window (second monitor) does not update until
  refocus or view re-show. Accepted: fixing it means polling while unfocused,
  a standing background cost for a niche viewing posture.
- The external-creation contract (name grammar, `-e DECK_SESSION`, `-c`) is
  public API, documented with a reference script so external agents don't
  transcribe the sanitization rules from prose (see ExternalTerminalWatch in
  CONTEXT.md; docs + script are tracked with the implementation, not here).

## Status

Accepted.
