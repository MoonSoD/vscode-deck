# ADR-0014: Terminal rows resolve from live tmux, not a persisted cache

## Context

The sidebar renders each Worktree's terminal rows. Today those rows come
from `deck.terminalSessionListCache` — a per-worktree-prefix mirror of
`tmux list-sessions` persisted in `globalState`, read synchronously when
the tree expands, then reconciled in the background (stale-while-revalidate)
against a fresh `list-sessions`.

That cache encodes a pre-control-mode assumption: *session discovery is
slow/async and unobservable, so persist a mirror and hand-maintain it.*
Three things make the assumption false now:

1. Sessions live on the **local DeckSocket** (`tmux -L deck`). `list-sessions`
   is a fast, local, read-only subprocess — not a network or git call.
2. **tmux is the single source of truth** for which sessions exist. The
   persisted mirror is a *second* copy that can only ever be stale or wrong.
3. The mirror must be hand-invalidated in four places — `addTerminalCommand`
   (`set`), `killTerminalCommand` (`removeSession`), the editor provider's
   `onPanelDispose` (`removeSession`), and `openPendingTerminalForCurrentWorktree`
   (`set`). Two QA bugs this cycle lived in exactly that sync seam:
   `33eadb7` (a `killSession` throw aborting cache cleanup) and the
   dangling-row saga. Bugs cluster where truth and mirror disagree.

VS Code already owns the *open tabs* (URIs, placement, restore — ADR-0013).
tmux owns the *sessions*. The persisted cache is a redundant third view of
state that nothing needs.

## Decision

1. **Delete `TerminalSessionListCacheStore` and its `globalState` key.**
   `getTerminalChildren` resolves rows directly:
   `toCachedTerminalSessions(path, await tmux.listSessions(prefix))`.
   The tree already returns `Promise<Node[]>` from its cold paths
   (`loadWorktreeChildren`), so async terminal children need no new
   machinery.

2. **Drop the stale-while-revalidate path for terminals.**
   `refreshTerminalsInBackground`, the `refreshingTerminals` guard set, and
   the `sameTerminals`/`sameTerminal` diff helpers are removed. (The
   *worktree* SWR cache stays — git common-dir resolution and
   `git worktree list` are slower and change rarely; terminals churn often
   and `list-sessions` is cheap. The two are no longer forced to share a
   pattern.)

3. **The four invalidation call sites simply disappear.** `addTerminalCommand`,
   `killTerminalCommand`, `onPanelDispose`, and
   `openPendingTerminalForCurrentWorktree` already call `tree.refresh()`;
   with no cache to poke, their `set`/`removeSession` calls are deleted.
   `refresh()` re-runs `getChildren`, which re-lists. One source of truth.

4. **The pure derivation survives, relocated.** `CachedTerminalSession` (kept
   for its `n`/`windowName` shape and the `TerminalNode` contract) and
   `toCachedTerminalSessions` move out of the store file into a memento-free
   module (`terminalSession.ts`). Nothing about the row model changes; only
   its source does.

5. **Freshness is unchanged in practice; live rename is unchanged.** External
   session changes reflect on the next `tree.refresh()` — tree-visibility,
   add, kill, cascade, or a tab's `%exit` — exactly the cadence the cache
   gave, minus its staleness window. Live relabel of *open* terminals still
   rides each tab's own control client `%window-renamed` → `tree.refresh()`
   (ADR-0012 / commit 92fbf40), untouched.

6. **No live "monitor" control connection in this ADR.** A single server-wide
   control client could push refreshes (`%sessions-changed` is broadcast to
   all control clients — verified in tmux `control-notify.c`), making the tree
   poll-free. It is **deferred**, not adopted: its only gain over decision 5
   is instant reflection of *externally-initiated* changes to *non-open*
   terminals (a rare case, already non-instant today), and it costs a
   persistent connection plus a dedicated hidden monitor session to attach to
   (a control client requires a session; Deck's churn). Live rename of
   non-open terminals can't ride it cleanly anyway — tmux delivers those as
   `%unlinked-window-renamed @<window-id>` (no session name; needs a
   window→session map). Not worth a persistent connection to delete a cache.
   Documented here so the spike is cheap if external-change latency ever
   matters.

## Consequences

- Removed: the store module + its test, the SWR terminal path, two diff
  helpers, one `globalState` key, and four cross-component invalidation
  calls. Net deletion; correctness up (no truth/mirror seam).
- Terminal rows resolve asynchronously on Worktree expand — a sub-frame delay
  versus today's instant paint-from-`globalState`. Acceptable: the Worktree
  node itself already resolves async on a cold window, and `list-sessions` on
  the local socket is ~tens of ms. Re-expanding re-lists (cheap, local,
  read-only).
- On a cold window reload, terminal rows appear shortly after the Worktree
  expands rather than from persisted state. No correctness change — VS Code
  restores the *tabs* (ADR-0013) regardless of when the *sidebar rows* paint.
- `migrateProjects`-style cleanup is unnecessary: an orphaned
  `deck.terminalSessionListCache` key left in `globalState` is inert and
  ignored once nothing reads it.

## Refines

- ADR-0008. Supersedes the second half of §4 (the `globalState`
  stale-while-revalidate cache); §4's headline — "source of truth = the
  DeckSocket; Deck persists no Terminal list" — is unchanged and reinforced.
- ADR-0011 / ADR-0012 / ADR-0013. This is a state-ownership cleanup *enabled*
  by them: control mode made tmux live-observable and VS Code-native restore
  removed the other persisted terminal store (`TabSnapshotStore`, ADR-0013),
  leaving the session-list cache as the last redundant terminal-state mirror.
  No decision in those ADRs is reversed; the Terminal *model* (ADR-0008 §2)
  and *surface* (ADR-0011) are untouched.

## Validation

- `control-notify.c` (tmux next-3.7, `~/code/tmux`): `%sessions-changed` is
  written to every control client on session create/close
  (`TAILQ_FOREACH(c, &clients)`), confirming a future monitor would see all
  Deck sessions server-wide. `%window-renamed` is session-scoped; other
  sessions' renames arrive as `%unlinked-window-renamed @<id> <name>`. These
  facts justify deferring the monitor (decision 6), not adopting it.
- Spike items if the monitor is ever revisited: which session a long-lived
  monitor attaches to and its behaviour when that session is killed;
  `%sessions-changed` cadence under rapid create/destroy (debounce the
  re-list); whether a dedicated `__deck_monitor` session (prefix-filtered out
  of the tree) is cleaner than re-attaching on death.

## Status

Accepted.
