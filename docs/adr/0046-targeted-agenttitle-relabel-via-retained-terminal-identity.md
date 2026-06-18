# ADR-0046: AgentTitle/AgentStatus changes relabel only their row, via retained Terminal node identity

## Context

Two high-frequency drivers fire a whole-tree refresh (`refreshTree` →
`onDidChangeTreeData.fire(undefined)`): the AgentTitle label poll (ADR-0041) on
every title change, and the AgentStatus watcher on every status write — and
`sameStatus` counts a `message` change as a change (ADR-0041), which agents emit
far more often than they rename. Terminal rows resolve **asynchronously** from
live tmux (ADR-0014: `getTerminalChildren` `await`s `list-sessions`), so VS Code
paints its loading twistie on **every** expanded Worktree's Terminals while that
promise settles — on every refresh, even when the resolved children are
identical. With a working agent, each title rewrite and each status/message
write blinks the **entire** tree; it reads as constant flashing and stops only
when every agent goes idle.

Both touch one thing — one Terminal's label, or one Terminal's working icon —
but drive a global re-resolve. The async resolve (ADR-0014) is correct and cheap
for *discrete* events; what's wrong is doing it for high-frequency, single-row
updates. The row display depends only on the AgentTitle and `status.status`
(working vs idle); a `message` change, and the needsInput/completed/failed
distinction (which rides the FileDecoration, not the row), touch nothing on it.

## Decision

An AgentTitle or AgentStatus change relabels **only the affected Terminal
row(s)**, with no re-resolve and no spinner.

1. **Retained node identity.** The provider keeps the `TerminalNode` instances
   VS Code holds, keyed by session name (`renderedTerminals`), reused across
   every `getChildren`. This is forced by the API: `onDidChangeTreeData.fire`
   resolves the fired element by **object identity** (`extHostTreeViews`
   `_nodes.get(element)`) — there is no fire-by-id — so a targeted refresh can
   only address a row the provider still holds a reference to.

2. **Mutate-in-place + targeted fire.** The relabel path updates the retained
   node's label/description/tooltip/icon and fires *that node*. VS Code calls
   `getTreeItem` for the leaf and ships the new item with **no `getChildren`
   call** — so the async terminal resolve (the spinner) never runs. Mutating a
   retained node between fires is invisible to VS Code (it renders only the
   `ITreeItem` snapshot sent at fire time), so sharing the instance is safe.

3. **The poll hands the data.** `AgentTitlePoll.onChange` widens to emit the
   changed `TmuxSession`s (it read them live this tick). The tree's relabel is
   then synchronous and race-free — no second `list-sessions`. This fits
   ADR-0041's framing of the poll as the freshness driver that owns labels.

4. **Fire only on a real display change.** `update` diffs the row's rendered
   signature (label + contextValue + icon) and reports whether it changed; both
   the title path and the status path fire only when it did. This makes the
   common AgentStatus `message` churn — and needsInput↔completed transitions,
   which move the FileDecoration but not the row — a no-op for the tree.

## Distinguished from ADR-0014

`renderedTerminals` is a **view-identity registry, not a session cache.** tmux
remains the single source of truth for which Terminals exist: every
`getChildren` still lists live, and the map is repopulated and pruned from that
result. It is in-memory only, never persisted, and never hand-invalidated
across call sites — the three properties ADR-0014 deleted. It holds node
instances solely so a targeted `fire` can find a row, the way TerminalOrder is
an overlay on live tmux rows rather than a mirror of them.

## Refines ADR-0041 §5

`onChange` drove a whole-tree `refreshTree`; it now drives a targeted row
relabel. The **status watcher** (`agentStatuses.onDidChange`) likewise no longer
calls the whole-tree `refresh()` — it relabels the rendered rows in place,
firing only those whose working icon changed. Status decorations
(needsInput/completed badges, repository/worktree rollups) are unaffected: they
ride the FileDecoration provider's own `onDidChange` subscription, never the
tree refresh.

The **`%window-renamed`** path (an open Terminal's control client, fired on the
agent hook's per-submit rename — ADR-0039 §1) likewise relabels only its row:
the editor provider hands the renamed session to the same `refreshTerminalDisplays`,
and the signature diff no-ops a rename that doesn't change the row (e.g. a
re-rename to the same `claude`).

The remaining whole-tree `fire(undefined)` is reserved for discrete structural
events (add/remove/switch, external git watch, visibility) — where ADR-0014's
async resolve is correct and cheap.

## Consequences

- `TerminalNode` becomes **mutable** (relabeled in place) and **reused** across
  `getChildren` rather than rebuilt fresh each time — the precondition for
  VS Code's identity-based targeted fire. The previous build-fresh-each-time
  style was incidental (nothing retained the nodes before).
- A title change for a Terminal not currently rendered (collapsed/foreign
  Worktree) is skipped — there is no row to relabel; the next expand builds it
  fresh from live tmux.

## Status

Accepted.
