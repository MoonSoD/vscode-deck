# ADR-0005: Post-create switch is opt-in, not automatic

## Context

`AddWorktreeCommand` today ends with `switcher.switchTo(newPath)` —
creating a Worktree immediately reloads the current window into it. Per
ADR-0003 that reload is the canonical switch mechanism; per ADR-0004 it
is disruptive enough that we shipped DetachedOpen as an opt-in escape
hatch.

The auto-switch-on-create makes Add Worktree the **single most expensive**
button in the extension: every successful add pays the reload cost
(workbench reload, LS cold re-index, debug session drop, webview reset,
re-activation of every other extension) — including when the user only
wanted to provision the worktree on disk for later.

Alternatives considered:

- **Keep auto-switch, add an undo path.** Rejected — there is no undo
  for a reload once it's begun, and `forceNewWindow` afterwards still
  costs a second window's cold start.
- **Modal QuickPick: Switch / Open in New Window / Stay.** Rejected —
  the user just clicked through 3 prompts (branch, base ref, path) to
  create the worktree. A fourth blocking prompt is heavier than the
  reload it avoids.
- **A `deck.autoSwitchOnCreate` setting defaulting to true.** Rejected —
  YAGNI; settings ossify decisions. The toast already lets the user
  pick per-invocation.
- **Refresh the tree silently and offer no prompt.** Rejected — strands
  the user one click further from the common case (they probably *do*
  want to go to the new worktree, just not unconditionally).

## Decision

After `addWorktree` succeeds, `AddWorktreeCommand` no longer auto-switches.
It instead:

1. Refreshes the tree so the new Worktree row appears immediately.
2. Shows a non-modal information toast: `Created worktree <branch>.`
   with two actions — `Switch` (invokes `WorktreeSwitcher.switchTo`, the
   existing SwitchOperation) and `Open in New Window` (invokes
   `DetachedOpener.open`, the existing DetachedOpen). `Open in New Window`
   is the rightmost / Enter-default action, matching this ADR's stance
   that reload is not the default cost.
3. Dismissing the toast is a first-class outcome: the Worktree exists
   on disk and in the tree; nothing further happens.

## Mechanics

- The toast is the only post-create UX; no status-bar or webview surface.
- The tree refresh happens **before** the toast is shown, regardless of
  what the user picks. On the Switch branch the refresh is immediately
  overwritten by the window reload — accepted, the symmetry with
  WorktreeRemovalCommand / RepositoryRemovalCommand (both inject a refresh
  hook) is worth more than the duplicated work.
- Dismiss does **not** mutate `ActiveWorktree[commonDir]`. CONTEXT.md
  defines ActiveWorktree as "the Worktree last *opened* for a Repository";
  a dismissed toast means never opened. Only the Switch branch writes
  the store, via the existing `switcher.switchTo` path.
- `AddWorktreeCommand` gains a `DetachedOpener` constructor dependency
  and a `refresh: () => void` hook, mirroring the existing removal
  commands.
- Branch name (not full path) is rendered in the toast text — the user
  just typed it; the path is noise at this point.
- Error path is unchanged: a failed `addWorktree` shows the existing
  error message and skips the toast entirely.

## Consequences

- Add Worktree is no longer destructive-in-place. Users can rapid-fire
  create multiple worktrees from one Repository node without paying N
  reloads.
- One extra click on the common-case "create then go there" flow. The
  Enter-default on `Open in New Window` makes the zero-reload version a
  single keystroke; the reload version is a deliberate `Switch` click.
- `AddWorktreeCommand` now coordinates two switch modes instead of one.
  Its constructor surface widens by one dependency. Accepted — the
  command stays a thin orchestrator over the existing deep modules
  (`WorktreeSwitcher`, `DetachedOpener`).

## Refines

- ADR-0003 (single-folder switching via `vscode.openFolder`). The
  reload-is-the-switch semantics are unchanged; this ADR only stops
  Deck from auto-paying that cost on Worktree creation. Default click
  on a Worktree row still reloads in place.
- ADR-0004 (Window-per-Worktree as an opt-in no-reload escape hatch).
  Same posture — let the user choose to pay the reload — extended to
  the creation moment.

## Status

Accepted.
