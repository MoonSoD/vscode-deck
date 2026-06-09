# ADR-0021: Reboot-surviving Agent Sessions via agent hooks and snapshot rewrite

## Context

ADR-0019 made Terminals survive death of the DeckSocket, but **shells only** —
`@resurrect-processes 'false'`, so a restored pane gets its cwd and scrollback
back and then a *fresh prompt*. When the Terminal was running an AI coding agent
(Claude Code or Codex), a reboot drops you back at a bare shell and the live
conversation is gone. Closing that gap is the goal: the **AgentSession** — the
resumable conversation a Terminal was running — comes back via the agent's own
resume (`claude --resume <id>` / `codex resume <id>`), not a new shell.

We verified the approach against three working references and the agents' own
docs:

- **`~/code/sanctel`** solved this exact problem: a hook writes a per-session
  sidecar with the agent's `session_id`, and at restore the resurrect snapshot
  is **rewritten** so the pane comes back already running the resume command
  (`snapshot_rewriter.rs`, `hook_handler.rs`, `hooks_installer.rs`).
- **`tmux-assistant-resurrect`** solves it differently: let resurrect restore a
  bare shell, then **`send-keys`** the resume command in, capturing argv + env to
  replay verbatim.
- **`~/code/superset`** has per-agent command *templates* (`claude --permission-mode
  acceptEdits`, `codex --dangerously-bypass-approvals-and-sandbox`) but does
  **not** resume terminal agents at all.

Both agents expose what we need. Claude Code hooks live in `~/.claude/settings.json`
(or a plugin); Codex hooks live in `~/.codex/hooks.json`. Both fire `SessionStart`
/ `UserPromptSubmit`, both hand the hook a `session_id` on stdin, and both resume
by id. Two findings shaped the design:

- **Deck's one-session-per-Terminal model removes all keying ambiguity.** The
  tmux session name (`wt-…__term-N`) *is* the Terminal identity, so a hook can
  bind its `session_id` to the exact Terminal — no cwd-based guessing, even with
  two agents in the same Worktree.
- **Deck's restore is eager and centralized** (one `restore.sh` pass on
  activation, gated by `restoreGate.ts`, with per-tab control clients attaching
  *after*). That regime makes snapshot-rewrite clean and `send-keys` racy — the
  opposite of plain interactive tmux where the two reference tools run.

## Decision

1. **An AgentSession is an *observed attribute* of a Terminal, not a Deck-managed
   entity.** Deck never launches agents — the user types `claude`/`codex` in a
   Terminal as today. Deck only observes the resumable `session_id` and captures
   it in the TerminalSnapshot. There are no agent rows, no chat surface, no
   spawn path. (This is what CONTEXT.md's "agent chat sessions are planned"
   resolves to.)

2. **Scope: Claude Code + Codex CLI.** opencode and others are out; the
   discovery seam is per-agent, so they slot in later without reworking
   rewrite/restore.

3. **Discovery via agent hooks, keyed by an injected `DECK_SESSION`.** Deck sets
   `DECK_SESSION=<session-name>` when it creates each Terminal's tmux session.
   The installed hook reads `$DECK_SESSION` and the `session_id` from its stdin
   payload and writes a sidecar `{agent, session_id}` keyed by session name.
   **Absence of `DECK_SESSION` is the no-op guard** — the hook fires for every
   `claude`/`codex` on the machine (the config is global) but does nothing
   outside a Deck pane. Passive reading of the agents' own session stores
   (`~/.claude/projects/…`, `~/.codex/sessions/…`) was rejected: cwd is not a
   unique key, and it cannot tell a running agent from an exited one.

4. **Resume by rewriting the resurrect snapshot before restore — not `send-keys`.**
   A new `snapshotRewriter` step runs *inside* `restoreOnActivation()`, before
   the `run-shell restore.sh` call: it reads the sidecars and replaces the
   pane-command column for any pane whose snapshot `pane_current_command` was
   `claude`/`codex` *and* has a sidecar. `send-keys` is rejected — it would race
   the restore gate and the per-tab control-client attach (§Context); rewrite
   composes with Deck's eager restore because the pane is correct *before* any
   client connects.

5. **The resume invocation comes from a per-agent template; no flag/env capture.**
   A setting per agent with an `{id}` placeholder, defaulting to the bare form
   (`claude --resume {id}`, `codex resume {id}`); power users override to carry
   their flags (`codex --dangerously-bypass-approvals-and-sandbox resume {id}`).
   Capturing real argv is fragile (macOS `comm` truncation) and capturing env
   would **write secrets into the on-disk snapshot** — both rejected. Env stays
   in the user's shell/agent config where it already lives. The template also
   keeps Deck **agent-grammar-agnostic** (the user writes the correct flag
   ordering / `resume` syntax, not Deck).

6. **Inject the bare resume command; it's non-destructive by construction.**
   Resurrect restores a process by **`send-keys`-ing** the command into the
   pane's already-running shell (`restore_pane_process`), *not* by exec'ing it as
   the pane process — so a bare `<rendered-template>` is inherently safe: a dead
   `session_id` flashes the agent's own "session not found" and returns to that
   shell at the right cwd (degrading to exactly ADR-0019's behavior), and a
   Terminal is never lost. *(An earlier `sh -lc '<resume>; exec "$SHELL"'` wrapper
   was dropped: it was redundant given send-keys, and inside that `sh` `$SHELL`
   resolved to `/bin/sh`, not the user's login shell — so an exited resume landed
   the user in the wrong shell. The bare command runs in the pane's restored shell
   (tmux `default-shell`), so the fallback is correct.)* Pre-validating the id
   against the agent's transcript files was rejected — it re-introduces the
   per-agent store coupling that §3 avoided.

7. **Install is consented, transparent, and reversible.** On activation Deck
   shows a notification for **detected** agents (binary on PATH or config dir
   present, honoring `CLAUDE_CONFIG_DIR`/`CODEX_HOME`); none detected → nothing
   shown. The **`Deck: Install agent hooks` command** is the explicit entry
   point: it skips the offer notification (the user already expressed intent) and
   goes straight to agent selection, reporting "already installed" / "none
   detected" rather than doing nothing silently. For multiple detected agents a
   quick-pick offers them pre-ticked.
   Before each write Deck **backs the config up to `<file>.deck.bak`**; after
   writing, a **Review changes** action opens a native diff (backup ↔ modified
   file) in the editor. *(A modal preview was tried first and rejected: VS Code
   modals don't scroll — microsoft/vscode#87266 — and rendering the merged file
   echoes the user's own secrets back at them. So we show the **change** in the
   editor's diff, not the **file** in a dialog — the shell-rc-norm trust
   linchpin, adapted to the right surface. The backup is also the diff's "before"
   side and a safety net for a bad merge; the surgical remove command stays the
   primary undo.)* Writes target the **user-global** config, **merge** into
   existing hooks (never clobber foreign entries), and are **tagged** for
   surgical removal. **`Deck: Uninstall agent hooks`** mirrors install: it
   quick-picks the *installed* agents (when more than one) and removes only the
   selected ones, leaving foreign hooks intact. Deck sets the expectation that
   **already-running agents must be restarted** to be tracked (a hook only binds
   sessions started after install). *(An automatic "arm-and-verify" — a post-install
   timer that confirmed the first captured sidecar — was tried and dropped: it
   couldn't tell "you haven't started an agent yet" from "hooks are broken," so it
   false-alarmed on the normal install-then-later case. The sidecar appearing when
   you run an agent is the real proof.)*

   **Delivery mechanism — v1 uniform config-layer hooks; v2 Claude plugin.** v1
   writes a tagged hook entry to both `~/.claude/settings.json` and
   `~/.codex/hooks.json` (one mechanism, one code path; Codex *forces* the
   config-layer file regardless — its plugin-local hooks reportedly don't fire,
   openai/codex#16430). The Claude **plugin** path — a namespaced, blessed,
   delete-to-remove footprint — is the documented v2 upgrade; it changes Deck's
   footprint, not the user-facing contract.

8. **No feature flag. State lives in two places only.** The **hooks on disk are
   the on/off** (the install/uninstall commands toggle them, per agent); a
   **`globalState` dismissal flag** suppresses the setup nag. Suppression is
   **only ever an explicit user choice**: the flag is set *solely* by "Don't ask
   again", and **cleared** when the install command is invoked (an explicit
   opt-in). **Uninstall never touches it** — so after removing an agent the
   activation offer can resurface it; "Don't ask again" is how you silence it.
   The *only* settings.json entries are the two resume-command templates from §5
   — config, not flags. "Installed?" is always read from disk, never cached.

9. **The setup-notification gate is evaluated per detected agent; dismissal is
   global.**

   ```
   show notification ⟺ ∃ agent: detected(agent) ∧ hooks-absent(agent) ∧ ¬dismissed
   ```

   Installing for one agent and adding another later therefore **re-prompts for
   the new agent only** (intended: installing signals intent, so we help extend
   it). The one accepted over-reach: dismissing globally also silences a
   hypothetical future third agent; the command palette is the way back.

10. **Restore announces itself through the agent's own UI.** `claude --resume`
    renders its conversation; that *is* the confirmation (as a restored browser
    session shows its tabs). The tree row already reads `claude`/`codex` via
    automatic-rename (ADR-0014 live read). No modal, no Deck banner, no dedicated
    "agent-backed" tree decoration in v1.

11. **`@resurrect-processes` is `:all:`, clamped by the rewriter — superseding
    ADR-0019 §1.** Snapshot-rewrite resume only works if resurrect actually
    restores a pane's command, so `deck.conf` sets `@resurrect-processes ':all:'`
    (ADR-0019 had `'false'`). To preserve ADR-0019's "shells only" guarantee for
    everything that is *not* a resumed AgentSession, the rewriter sets every
    non-agent pane's full-command column to `:` (bare shell), which resurrect's
    restore then skips (`$11 !~ "^:$"`). Net: agents resume, everything else
    returns as a shell — ADR-0019's scope preserved by construction. This makes
    the rewrite **load-bearing**: it runs on every restore (wired into
    `restoreOnActivation` before `restore.sh`) and is **best-effort**, so a
    failure degrades to shells rather than aborting restore. A narrower
    `~`-sentinel allowlist (matching only Deck's injected resume command) was considered
    as defense-in-depth against a buggy rewrite leaving a stray program; deferred
    as optional, since the clamp plus best-effort cover the real paths.

## Considered Options

- **Passive session-store reading (cwd-keyed)** — rejected: cwd isn't unique per
  Terminal, and it can't distinguish running from exited (§3).
- **`send-keys` after restore** (tmux-assistant-resurrect) — rejected: races
  Deck's eager, centralized restore + per-tab attach (§4).
- **Capture argv + env and replay verbatim** (tmux-assistant-resurrect) —
  rejected: argv capture is fragile and env capture writes secrets to the
  snapshot (§5).
- **Adopt the `tmux-assistant-resurrect` plugin wholesale** — rejected: it is
  self-described "vibecoded" with limited usage, and its `send-keys` model is the
  wrong fit for Deck at a load-bearing layer.
- **Claude plugin for v1** — deferred to v2: cleaner footprint, but Codex can't
  use it (openai/codex#16430), so it would mean two code paths; transparency
  (preview-before-write) closes most of the trust gap a plugin would (§7).
- **A tri-state / boolean feature flag** carrying enable + dismissal — descoped
  (§8): the disk fact plus a `globalState` dismissal express on/off and nagging
  without a confusing overloaded key.

## Consequences

- **Deck mutates user-global agent config.** This is the cost of reliable
  discovery; it is bounded by consent, exact-change preview, idempotent merge
  (foreign hooks untouched), and one-command removal.
- **Couples to the vendored tmux-resurrect snapshot format.** Contained: the
  plugin is pinned (ADR-0019) and the column layout is frozen and under Deck's
  control — the natural home for a focused unit test (sanctel has exactly this).
- **`DECK_SESSION` is injected into every Terminal session** (extends ADR-0008
  session creation). It is also the hook's no-op guard.
- **TerminalSnapshot now captures the AgentSession.** ADR-0019's reboot story —
  "whatever was *running* is not relaunched" — no longer holds for agents; it
  still holds for every other program.
- **Failure degrades to ADR-0019 behavior** (bare shell at cwd): the bare resume
  command is send-keys'd into the restored shell (§6), so a bad resume returns to
  that shell — a Terminal is never lost.
- **Coexists with sanctel** (which the maintainer also runs): writes are
  idempotent and merge-based, sidecar dirs are Deck-namespaced, and the
  per-agent gate tolerates foreign hooks. Deck never assumes sole ownership.

## Refines

- **ADR-0019.** TerminalSnapshot gains the AgentSession; the `snapshotRewriter`
  runs inside `restoreOnActivation()` *before* `restore.sh`. The 5-min save
  cadence is unchanged (a sidecar captured between saves still resumes — the
  rewrite reads sidecars at restore time, not save time). **Supersedes §1's
  `@resurrect-processes 'false'` → `:all:`** (see Decision 11); the rewriter's
  shell-clamp keeps §1's "shells only" scope for non-agent panes.
- **ADR-0008.** Each Terminal's tmux session is created with a `DECK_SESSION`
  env var — on the `+`-create path (`ensureSession`), the control client's
  create-or-attach, and resurrect's restore (vendored `new_session` patched), so
  the var survives reboots.
- **ADR-0014.** Reinforced: the row label still comes from live tmux
  (automatic-rename surfaces `claude`/`codex`); no persisted agent state in the
  tree.

## Validation

- **Snapshot rewrite + exit detection:** sanctel `snapshot_rewriter.rs`
  (`resume_command`, `pane_is_running_agent` comparing the snapshot's
  `pane_current_command` against `claude`/`codex*`), driven from
  `restore_runtime.rs`.
- **Hook → sidecar keying:** sanctel `hook_handler.rs` (session resolved from the
  pane, sidecar `{agent, session_id, …}`), `hooks_installer.rs` (merge into
  `~/.claude/settings.json` / `~/.codex/hooks.json`), `agent_session_watcher.rs`.
- **Codex:** global hooks at `~/.codex/hooks.json`, payload includes `session_id`
  + `transcript_path`, layers merge without clobbering, `codex resume <id>`
  (developers.openai.com/codex/hooks, /cli/reference). Plugin-local hooks gap:
  openai/codex#16430.
- **Claude:** plugins bundle `hooks/hooks.json` (SessionStart/UserPromptSubmit),
  expose `${CLAUDE_PLUGIN_ROOT}`; enabling writes a small `enabledPlugins` entry;
  an in-place `@skills-dir` plugin needs no install step and is removed by
  deleting its folder (code.claude.com/docs/en/plugins-reference).
- **`pane_current_command` is unreliable for Claude** (QA, macOS): Claude Code
  reports its **version** (e.g. `2.1.168`) as `#{pane_current_command}` (snapshot
  column 9), not `claude`. The rewriter therefore matches the agent against the
  ps-derived **full-command** column (10, which reads `claude`) as well as column
  9 — matching only column 9 silently failed to resume.
- **Verified (QA, macOS):** install → capture → `kill-server` → restore resumes
  the conversation; the restored session keeps `DECK_SESSION` and re-captures
  (High-1); the hook no-ops when `$DECK_SESSION` is absent. The bare resume
  command (spaces, no tabs) survives resurrect's tab-delimited column and runs in
  the restored `default-shell`.

## Status

Proposed.
