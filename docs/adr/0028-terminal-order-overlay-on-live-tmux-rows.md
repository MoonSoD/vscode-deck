# ADR-0028: Terminal order is a persisted overlay on live tmux rows

## Context

Terminals are reorderable by drag in the sidebar (this feature). Their rows
resolve from live tmux on every expand — ADR-0014 deleted the persisted
terminal-list cache and reasserted ADR-0008 §4: *"source of truth = the
DeckSocket; Deck persists no Terminal list."*

A user-curated display order has to live *somewhere*, and tmux has no notion of
it: `toCachedTerminalSessions` sorts by the `term-N` number embedded in the
session name (`terminalSession.ts:21`), which is allocation order, not the
user's order. So reordering needs persisted state — seemingly the exact thing
ADR-0014 removed.

It is not. The distinction is **existence vs. curated order**, already drawn
for Worktrees:

| | Existence (source of truth) | Curated order (overlay) |
|---|---|---|
| Worktrees | live `git worktree list` | `WorktreeOrder` (paths) |
| Terminals | live tmux `list-sessions` | `TerminalOrder` (session names) ← new |

`WorktreeOrder` persists worktree *paths* without owning the worktree *list* —
`reconcileWorktreeOrder` drops any stored path that no longer exists. ADR-0014
killed a cache that answered *"which Terminals exist"*; `TerminalOrder` answers
*"in what order"* and still asks tmux what exists.

## Decision

1. **New `TerminalOrder` store**, keyed by **worktree path**, value an ordered
   list of **session names**. Twin of `WorktreeOrderStore`. (Worktree path, not
   common dir: a Terminal belongs to one Worktree — CONTEXT.md.)

2. **`reconcileTerminalOrder`** mirrors `reconcileWorktreeOrder`: emit stored
   entries that are still live (in stored order), then append live sessions not
   in the stored order, in `term-N` order. So a **freshly created Terminal
   lands at the bottom** — matching today's highest-`n`-last behavior, so
   nothing regresses for users who never drag. `getTerminalChildren` applies
   the overlay; `toCachedTerminalSessions` keeps its `n`-sort as the fallback.

3. **Session name is the stored identity** (ADR-0015: the session name *is* the
   Terminal's identity). No new id is introduced.

4. **Self-healing prune, shared by both order stores.** `allocateTermN` is
   `max(live n) + 1`, not a monotonic counter (`tmuxSafe.ts:17`) — kill the
   highest-numbered Terminal and the next one reuses that name. A stale stored
   entry would then hand a *new, unrelated* Terminal the dead one's slot. Fix:
   when reconcile finds a stored entry that is no longer live, rewrite the
   stored order without it — once, only on observed drift, in the read path.
   The killed name is gone before its number is reused, so the new Terminal
   correctly lands at the bottom. No hooking of kill paths (cascade, `exit`,
   Worktree/Repository removal); we GC against the live truth we already read.
   The same prune retrofits `WorktreeOrder`, which had the latent variant of
   this bug (a path re-created at a removed location).

## Consequences

- A tiny write returns to the terminal read path — but it is *order-overlay
  garbage collection against truth already in hand*, not the existence mirror
  ADR-0014 deleted. It fires only on drift, then goes quiet; no per-render
  churn, no cross-component invalidation seam.
- Cross-worktree Terminal moves remain out of scope (the session name embeds
  the Worktree path; moving means re-homing identity — a separate feature).

## Refines

- **ADR-0014 / ADR-0008 §4.** Draws the existence-vs-order line for Terminals
  that already exists for Worktrees. "Deck persists no Terminal *list*" stands;
  Deck now persists a Terminal *order overlay*, reconciled against the live list.

## Status

Accepted.
