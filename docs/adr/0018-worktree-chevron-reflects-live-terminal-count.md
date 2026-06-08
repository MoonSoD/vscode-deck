# ADR-0018: Worktree chevron reflects live terminal count (Withdrawn)

## Status

**Withdrawn** — superseded before merge by a simpler approach; never shipped.

## Context

This ADR proposed gating a Worktree's expand chevron on its live Terminal
count (`Expanded` when it hosts Terminals, `None` when empty) so empty
Worktrees rendered as leaves. Because the chevron then needed the count *at
build time*, it forced a trilemma against ADR-0007 §3 (synchronous worktree
render) and ADR-0014 (no persisted Terminal cache), resolved by making worktree
render `await` one grouped `tmux list-sessions` per Repository and threading the
result into Terminal-row resolution.

## Why withdrawn

The product decision changed: **empty Worktrees should also expand by default**
(behave like an empty folder — chevron present, expands to no rows), not render
as leaves. With the chevron no longer conditional, the build-time count is
unnecessary, the trilemma disappears, and the grouping module / render-version
threading were all reverted.

The shipped behavior needs no new architectural decision and lives in the
baseline ADRs:

- **Worktrees expand by default** — `WorktreeNode` is unconditionally
  `Expanded`; the prior `Collapsed` default is gone. A manual collapse is
  transient (re-expands on the next `refresh()`), accepted in lieu of a
  persisted expansion store.
- **The "Add Terminal" empty-state hint row is removed**; the always-visible
  inline `+` on the Worktree row is the sole add affordance. An empty Worktree
  expands to no rows.
- **Terminal rows stay live and lazy** per Worktree on expand (ADR-0014), and
  **worktree rows still render synchronously from cache** (ADR-0007 §3) — both
  unchanged.

See issue #72 for the user-facing rationale.
