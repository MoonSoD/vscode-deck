# ADR-0051: DisconnectedTab detection is evidence-only

## Context

After an extension-host restart that is not a full window reload, VS Code keeps
already-shown Deck Terminal custom-editor tabs alive but does not call
`resolveCustomEditor` for them again. The old webview still paints its last
scrollback, but the new extension host has no transport attached to it:
keystrokes go nowhere and no output arrives. The Terminal is not lost; it still
lives on the DeckSocket. The broken object is only the tab view.

VS Code's public tab API exposes the surviving tab input, but not a way to
reattach the old webview to the new extension host. The practical repair is to
close the tab and open the same `deck-terminal:` URI again, which creates a new
custom-editor instance and reattaches to the same tmux session.

## Decision

Deck detects a **DisconnectedTab** only from direct evidence: a Deck Terminal
tab is active in its group and, after a grace period, the terminal editor
provider still has no registered panel for that session. Startup checks each
group's active tab after a longer grace period; later tab activations use a
shorter grace period. A tab that resolves during the grace period is healthy and
is never badged.

Deck marks proven DisconnectedTabs with a FileDecoration on their
`deck-terminal:` URI: `!`, `disabledForeground`, and a tooltip pointing to
Reopen Terminals. This decoration outranks AgentStatus dots because status on a
view the user cannot interact with would be misleading.

The repair is consent-first. Deck raises a throttled notification with one
action, **Reopen Terminals**, and contributes `deck.reopenTerminals` for command
palette and keybinding use. Dismissing the notification performs no tab
operation; badges stay. Deck prompts only when a DisconnectedTab is newly
proven. After dismissal, the durable remedy surfaces are the badge tooltip, the
`deck.reopenTerminals` command, and the notification center.

When the user accepts, Deck reopens every currently unwired Deck Terminal tab in
one batch. The reopen planner is pure and works from a tab-groups snapshot:
hidden unwired tabs reopen before the active unwired tab, original tab index and
pin state are restored, per-group active tabs are re-revealed when possible, and
the originally focused group's active tab is revealed last. If a group's active
tab cannot be re-revealed by URI and is not itself being reopened, Deck skips
that group rather than stealing the active tab.

## Considered options

- **Persist shown-tab state, rejected.** A stored record can be stale across
  window reloads and tab closes, which gives the detector a false-positive
  path. The badge may be late; it must not lie.
- **Infer all hidden Deck tabs are disconnected, rejected.** Tabs not shown
  since the window opened can still resolve lazily against the new host. Badging
  them would mark healthy tabs as broken.
- **Silent auto-reopen, rejected.** It repairs quickly but churns tabs and focus
  without consent. A user may be reading stale scrollback and may not want Deck
  to close anything yet.

## Consequences

- Detection is conservative: a disconnected hidden tab is marked only when it
  becomes active or is active during the startup sweep.
- The repair may reopen a healthy panel-less Terminal tab during the accepted
  batch. That is acceptable because the user explicitly asked to reconnect
  Terminals and opening the same URI reattaches to the same tmux session.
- If VS Code later re-resolves surviving custom-editor tabs after extension-host
  restarts, this machinery becomes inert and can be removed.

## Status

Accepted.
