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

6. **Wrap the resume so a failed/stale id never loses the Terminal.** Inject
   `<rendered-template>; exec $SHELL` semantics rather than the agent as the
   pane's process. A dead `session_id` flashes the agent's own "session not
   found" and falls through to an interactive shell at the right cwd — i.e. it
   degrades to exactly ADR-0019's behavior. Injecting the agent *as* the pane
   process would close the window on a non-zero exit and **destroy** a Terminal
   that would otherwise have restored fine. (This is the safety property
   `send-keys` gets for free; the wrap ports it into the rewrite world without
   the race.) Pre-validating the id against the agent's transcript files was
   rejected — it re-introduces the per-agent store coupling that §3 avoided.

7. **Install is consented, transparent, and reversible.** On activation Deck
   shows a notification for **detected** agents (binary on PATH or config dir
   present, honoring `CLAUDE_CONFIG_DIR`/`CODEX_HOME`); none detected → nothing
   shown. The setup panel lists only detected-and-not-yet-installed agents,
   pre-ticked, and **previews the exact change before writing it** (the trust
   linchpin from the shell-rc-injection norm — starship/atuin/direnv print/show
   rather than silently edit). Writes target the **user-global** config, **merge**
   into existing hooks (never clobber foreign entries), and are **tagged** for
   surgical removal (`Deck: Remove agent hooks`). After install, Deck **arms and
   verifies**: it watches for the first sidecar to appear and confirms capture
   worked in-context — turning an unverified promise into an observed fact, and
   surfacing a broken hook immediately instead of post-reboot. Deck also sets the
   expectation that **already-running agents must be restarted** to be tracked
   (a hook only binds sessions started after install).

   **Delivery mechanism — v1 uniform config-layer hooks; v2 Claude plugin.** v1
   writes a tagged hook entry to both `~/.claude/settings.json` and
   `~/.codex/hooks.json` (one mechanism, one code path; Codex *forces* the
   config-layer file regardless — its plugin-local hooks reportedly don't fire,
   openai/codex#16430). The Claude **plugin** path — a namespaced, blessed,
   delete-to-remove footprint — is the documented v2 upgrade; it changes Deck's
   footprint, not the user-facing contract.

8. **No feature flag. State lives in two places only.** The **hooks on disk are
   the on/off** (`Install`/`Remove` commands toggle them); a **`globalState`
   dismissal flag** suppresses the setup nag (set by "Don't ask again" *or* by an
   explicit Remove). The *only* settings.json entries are the two resume-command
   templates from §5 — config, not flags. "Installed?" is always read from disk,
   never cached as a preference.

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
- **Failure degrades to ADR-0019 behavior** (bare shell at cwd) via the §6 wrap;
  a Terminal is never lost to a bad resume.
- **Coexists with sanctel** (which the maintainer also runs): writes are
  idempotent and merge-based, sidecar dirs are Deck-namespaced, and the
  per-agent gate tolerates foreign hooks. Deck never assumes sole ownership.

## Refines

- **ADR-0019.** TerminalSnapshot gains the AgentSession; the `snapshotRewriter`
  runs inside `restoreOnActivation()` *before* `restore.sh`. The 5-min save
  cadence is unchanged (a sidecar captured between saves still resumes — the
  rewrite reads sidecars at restore time, not save time).
- **ADR-0008.** Each Terminal's tmux session is created with a `DECK_SESSION`
  env var.
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
- **Open verification items:**
  - The §6 wrap (`<resume>; exec $SHELL`) must survive resurrect's tab-delimited
    snapshot column parsing (`;`, spaces) on restore.
  - The hook no-ops correctly when `$DECK_SESSION` is absent (non-Deck `claude`).
  - Arm-and-verify timing: a sidecar appears within a few seconds of the first
    `SessionStart`/`UserPromptSubmit` so the confirmation feels immediate.

## Status

Proposed.
