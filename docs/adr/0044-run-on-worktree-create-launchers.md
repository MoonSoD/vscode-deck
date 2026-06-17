# Run-on-worktree-create launchers bootstrap a new Worktree

A TerminalLauncher may carry `runOnWorktreeCreate: true`. When a Worktree is
created through Deck's Add command, every such launcher (from both
`<worktree>/.deck/launchers.json` and `deck.terminalLaunchers`) fires
automatically and headless — Deck creates the tmux session, sends the command,
and does **not** open an editor tab — turning launchers into per-worktree
bootstrap (e.g. `mise install && pnpm bootstrap` in one Terminal, `claude` in
another). This reuses the existing TerminalLauncher machinery (ADR-0043), so a
launcher running an agent is still observed and resumed for free, and Deck still
does not own the agent lifecycle.

## Considered options

- **A separate "bootstrap" concept** with its own config list, distinct from
  manual launchers. Rejected — it would duplicate the source-merging, the
  committed `.deck/` file, and the agent-resume property for no domain gain. The
  only new thing is *when* a launcher fires, so it is a trigger on
  TerminalLauncher, not a new concept.
- **An explicit `commands: string[]` per launcher** for multi-step bootstrap.
  Rejected — a single `command` with `&&` already sequences steps and fails fast
  (a broken `mise install` must not reach `pnpm bootstrap`); parallel steps are
  expressed as separate launchers. Keeps manual and auto launchers one shape.
- **Prompt before running** (a toast action). Rejected — the requirement is
  *automatic* provisioning; the launcher declaring its own trigger in
  user-authored data is the opt-in. ADR-0005's post-create toast still handles
  the orthogonal navigation choice (Switch / Open in New Window).
- **Open an editor tab per launched Terminal**, as the manual launcher does.
  Rejected — a create whose toast is dismissed must stay non-disruptive
  (ADR-0005); opening N foreign-Worktree tabs into the current window violates
  the "Terminal is durable, tab is a view" model (ADR-0017). The commands run on
  the DeckSocket regardless; the user opens a tab when they visit.
- **Fire on any worktree creation, including external `git worktree add`
  detected by ExternalGitWatch (ADR-0020).** Rejected — ExternalGitWatch is a
  sync signal, not a provisioning event, and cannot distinguish "just created"
  from "just discovered." Honoring it would launch `claude` + `pnpm bootstrap` in
  every pre-existing Worktree the moment a Repository is registered. Scoped to
  `AddWorktreeCommand` only.

## Consequences

- Refines **ADR-0005** (post-create is opt-in/inert): create now has automatic
  side effects, but no window reload — launchers run headless on the DeckSocket,
  independent of the toast choice, so the reload cost ADR-0005 protects stays
  unpaid.
- Refines **ADR-0043** (launchers via manual Quick Pick): launchers gain a
  non-manual trigger. The data shape `{ label, command }` gains one optional
  boolean; manual-only launchers omit it.
- A failed bootstrap step is visible only in the Terminal's scrollback (seen when
  the row is opened) — no failure toast, consistent with "typed in exactly as the
  user would." Agent status is still surfaced via the AgentStatus path
  (ADR-0025, ADR-0040).

## Status

Accepted.
