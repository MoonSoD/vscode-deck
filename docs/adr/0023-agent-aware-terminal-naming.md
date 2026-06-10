# ADR-0023: Agent-aware Terminal naming via the existing agent hook

## Context

A Terminal's `#{window_name}` drives both the sidebar row (`describeTerminalTreeItem`)
and the editor tab. For a Terminal running an AI agent that name is useless:
`automatic-rename` follows `#{pane_current_command}`, which for **Claude Code**
is its **version string** (e.g. `2.1.168`) and for **Codex** is the native binary
`codex-aarch64-apple-darwin` (truncated to `codex-aarch-a`). Neither recovers a
clean agent identity. (This empirically **corrects ADR-0021 §10**, which asserted
the row "already reads `claude`/`codex` via automatic-rename" — it does not; that
false belief is why this was never built.)

A tmux `automatic-rename-format` (the #85 / ADR-0022 knob) **cannot** fix this:
the format language only sees `#{pane_current_command}` (the version), not the
ps-derived full command that reads `claude`. (Codex is a near-miss — its command
*contains* `codex` — but relying on that is fragile across install methods.) The
established tmux-community answer is a `SessionStart` hook that runs
`tmux rename-window`, paired with a `SessionEnd` hook restoring `automatic-rename`
(a manual rename latches auto-rename **off** for that window).

Deck is better positioned than the blog hacks: it **already** installs an agent
hook keyed to the Terminal by `DECK_SESSION` (ADR-0021), so it knows the agent
identity per Terminal without `basename $PWD` guesses or a `$TMUX` guard.

This is deliberately **scoped to identity only** — not status (working / idle /
awaiting-input). The community renders status into the tmux **status line or a
sidebar pane**, surfaces Deck does not have (`status off` is load-bearing —
ADR-0022; xterm.js renders no status bar). Status would have to ride in the window
name (churning a `rename-window` on every `Stop`/`Notification`) or build the
agent-aware tree decoration ADR-0021 §10 deferred — a separate, larger feature.

## Decision

1. **Name agent windows with the agent identity (`claude` / `codex`), nothing
   more.** Worktree is the tree parent (redundant where it matters); status is
   out of scope (see Context).

2. **The hook issues the rename, on `SessionStart`.** The installed hook already
   runs in-context with the agent name and `DECK_SESSION`; it adds one line —
   `tmux -L deck rename-window -t "$DECK_SESSION" "$agent"`. Deck renders the
   exact socket into the script, so it never relies on `$TMUX` (Claude's
   v2.1.139 "no controlling terminal" change doesn't affect env-var inheritance
   or non-TTY tmux state commands). This **composes with existing plumbing**: the
   rename emits `%window-renamed`, which `TmuxControlClient` already turns into a
   tree refresh + tab-title re-read.

   This nudges the hook from *pure observer* (ADR-0021 §1) to *observer +
   presenter*. Accepted: Deck reflects an observed fact (*agent X started here*)
   onto its own presentation surface; it still never launches or controls the
   agent.

3. **Teardown is "P2": Claude restores via `SessionEnd`; Codex is accepted-stale.**
   A `SessionEnd` hook restores `automatic-rename on` for the window so it reverts
   to a shell name on exit. Claude exposes `SessionEnd` (fires on `/exit` and
   ctrl-d). **Codex exposes no session-end event** — verified in source
   (`codex-rs/protocol/src/protocol.rs:1359`: 10 hook events; only
   `SessionStart` is thread-scoped; `Stop` is turn-scoped). So a Codex window
   stays named `codex` after exit until the Terminal is reused or removed. This
   is **cosmetic only** — resume is gated on the *snapshot's* command columns
   (`snapshotRewriter.isRunningAgent`), never the live name, so a stale name can
   never cause a wrong `--resume`; and it is no worse than the pre-feature
   baseline. Tracked for resolution in **#87** (upstream openai/codex#20603, or
   the extension-side polling fallback below).

4. **Installs a new hook event — `SessionEnd` (Claude).** Extends ADR-0021's
   installed set (`SessionStart` + `UserPromptSubmit`). The rename uses
   `SessionStart`, which Deck already installs.

5. **Restore re-drives the name through the hook, not the snapshot.** The window
   name is not captured in the TerminalSnapshot. On restore, a resumed
   AgentSession fires `SessionStart` (matcher `resume`) → the hook re-renames; a
   non-resumed pane returns to a shell and auto-rename names it. Nothing new in
   the snapshot/rewrite path.

## Considered Options

- **`automatic-rename-format` (the #85 knob) alone** — rejected: the format
  language can't see the ps-derived command that reads `claude` (only the version).
- **The extension issues the rename** (hook signals Deck) — rejected for v1: the
  hook already has everything in-context and reuses the `%window-renamed` path;
  extension-side adds a method, watch latency, and a second owner.
- **Status in the name** (working / idle / awaiting-input) — deferred: Deck lacks
  the status-line/sidebar surface the community uses, and per-event renames churn
  the tree. A separate feature.
- **P1 — no teardown for either agent** — rejected: leaves Claude stuck-named too,
  a visible wart on the primary agent for no saving over P2.
- **P3 — extension-side teardown by watching the pane's process tree** — deferred
  to #87: robust and uniform across both agents, but introduces Deck's first poll
  loop (Deck is event-driven — ADR-0020/0022). Prefer the upstream Codex hook
  (openai/codex#20603) first. A foreground-command check is explicitly unsafe —
  agents shell out to tools, so `pane_current_command` returning to a shell is a
  false "exited" signal; only process-tree liveness is reliable.

## Consequences

- The hook gains a second responsibility (rename) beyond writing the sidecar, and
  Deck installs one additional event (`SessionEnd`). Both are small, additive
  changes following ADR-0021's merge-and-tag install machinery.
- **Claude/Codex teardown is asymmetric** until #87: Claude reverts cleanly, Codex
  stays named after exit. Documented limitation, not a bug.
- Composes with ADR-0022's `automaticRenameFormat`: the manual name overrides the
  user's format while the agent runs (intended); `SessionEnd` re-enables the
  format afterward (Claude).
- **Naming timing differs per agent, dictated by the platform.** Claude runs
  `SessionStart` hooks at launch, so its window names immediately. **Codex defers
  `SessionStart` (and all turn-scoped) hooks to the first turn** (verified in
  source: the source is queued in `session.rs` and drained from `run_turn`), so a
  Codex window stays command-named (`codex-aarch64-…`) until the **first prompt**,
  then names `codex`. Our `UserPromptSubmit` rename coincides, so no extra work is
  needed — but there is no way to name a Codex window before its first turn. Not a
  bug; a Codex trait.
- **Deck keeps its own hook scripts current on activation.** The hook *script*
  lives in Deck's data dir, not user config, so a Deck upgrade that changes the
  script body (e.g. adding the rename step) is reconciled silently on activation
  (`HookInstaller.refreshInstalledScripts`) — no reinstall, no re-consent, and
  Codex's trust hash (over the command string, not the script body) stays valid.
  This was added after QA found an upgraded install still running the pre-rename
  script, invisible to the install gate because its events were unchanged. Hook
  *event-set* changes still flow through the consented install path.
- **Corrects ADR-0021 §10** — see the note added there.

## Status

Accepted — shipped in v0.4.0.
