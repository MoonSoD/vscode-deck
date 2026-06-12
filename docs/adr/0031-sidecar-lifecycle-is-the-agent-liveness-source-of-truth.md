# ADR-0031: Sidecar lifecycle is the agent-liveness source of truth

## Context

ADR-0021 resumes an **AgentSession** after a DeckSocket restart by rewriting the
**TerminalSnapshot**: for each pane, `SnapshotRewriter.isRunningAgent` inspects
the snapshot's `pane_current_command` (column 9) and the ps-derived
`pane_full_command` (column 10); if either names the agent *and* a **sidecar**
(`{agent, session_id}`) exists, it injects `claude --resume <id>` / `codex resume
<id>`, otherwise it clamps the pane to a bare shell.

That detection is wrong in practice, on two independent axes:

- **Unreliable.** Claude Code reports its **version string** (e.g. `2.1.172`) as
  `pane_current_command`, not `claude`; the documented column-10 fallback is dead
  because resurrect's `ps` strategy returns an **empty** full-command in the real
  snapshot. So a running Claude reads as "not an agent" and restores to a shell.
- **Stale.** The snapshot is captured on the 5-minute resurrect save cadence, so
  columns 9/10 describe the pane *as of the last save*, not now. Quitting an agent
  to a shell and rebooting within that window leaves the snapshot saying "agent
  running" → a spurious resume of a session the user deliberately exited.

The repo already has an agent-agnostic, continuously-maintained liveness signal —
the **AgentExitSweep** (ADR-0025 lineage, issue #110) driving
`AgentLivenessProbe` — but it is wired to govern the **AgentStatus**, keyed off
the tmux **window name** for discovery and the status file for the process
identity, not the sidecar. Liveness cannot be probed *at restore* (after a
kill/reboot no agent process is alive — the probe says "dead" for everything), so
it must be captured while the agent runs.

## Decision

1. **Sidecar presence is the resume signal; delete snapshot-column detection.**
   `SnapshotRewriter` resumes any pane that has a sidecar and clamps every other
   pane to a shell; `isRunningAgent` and its column-9/10 parsing are removed. The
   resume decision is read from the sidecar at restore time, not inferred from a
   stale snapshot column.

2. **The sidecar carries the process identity; the status file drops it.** The
   sidecar becomes `{agent, session_id, pid, startTime}` — the resume identity
   plus everything the liveness probe needs. `pid`/`startTime` are removed from
   the **AgentStatus** schema and from the hook's status writer, so each fact
   lives in exactly one place. The sidecar's `pid` is volatile (meaningless after
   a reboot) but is only ever read by the sweep *while the machine is up*; the
   restore path never probes it.

3. **The sweep discovers and probes from sidecars, not the window name.**
   `AgentExitSweep` iterates `AgentSidecarStore.readAll()`, probes each
   `{pid, startTime}`, and on detected death **removes the sidecar** (and
   best-effort clears the status / resets the window name for the UI). The window
   name stops being a functional signal.

4. **Each exit path removes the sidecar exactly once.**
   - Claude graceful quit → the `SessionEnd` hook removes the sidecar (it already
     removes the status and resets the window name; `sidecar_dir` must be defined
     before the `SessionEnd` branch).
   - Codex quit/crash and Claude hard-crash → the sweep removes it (no
     `SessionEnd` fires; for Claude the sweep is the backstop, for Codex — which
     has no `SessionEnd` at all — it is the only mechanism).
   - DeckSocket kill / reboot → the sweep is not running, so the sidecar
     **persists** → the pane resumes. This is the desired outcome.

5. **Liveness = alive + start-time match; drop the command-name check.**
   `AgentLivenessProbe` keeps the `kill(pid, 0)` aliveness check and the
   `startTime` equality check, and drops the `ps -o command=` agent-name match.
   `startTime` already defends against PID reuse (a reused PID belongs to a
   later-started process, so its start time differs — and it distinguishes two
   same-type agents, which the command match cannot). The command match was
   redundant at best and a false-negative risk at worst: on macOS Node rewrites
   its argv when a program sets `process.title`, so `ps -o command=` can return
   Claude's version string and wrongly mark a live, idle Claude as dead.

6. **Window name and status are UI-only.** After this change nothing reads the
   window name or the status file to decide resume or liveness; they remain the
   tree's row label/icon (ADR-0023) and activity indicator (ADR-0025).

## Considered Options

- **Patch the column heuristic** (accept a version-string `pane_current_command`
  for Claude) — rejected: smallest change, but still reads the 5-minute-stale
  snapshot column, so it keeps the quit-then-reboot spurious-resume, doesn't fix
  the empty column-10 root cause, and leaves the fragile per-agent parsing in
  place.
- **Bake the resume decision into the snapshot at save time** via the liveness
  probe — rejected: removes the column parsing but inherits the same 5-minute
  save-cadence staleness, and is more new machinery than making the sidecar
  authoritative.
- **Keep the command-name liveness check** — rejected per Decision 5.

## Consequences

- **The hook script changes, so installed hooks are reconciled for every user**
  on next activation (`reconcileInstalledHooks` — consented, backs up to
  `<file>.deck.bak`, shows a "Review changes" diff). The user-facing contract is
  unchanged.
- **Correct across the save window.** Because liveness is tracked continuously in
  the sidecar (removed within ~5 s of an exit, or instantly on a clean Claude
  quit), resume reflects reality as of seconds — not up to 5 minutes — before the
  crash.
- **Residual over-resume window of one sweep interval (~5 s):** an agent that
  exits less than ~5 s before a kill+reload may still have its sidecar and
  resume. This is non-destructive by ADR-0021 §6 — a dead `session_id` flashes
  the agent's "session not found" and returns to the restored shell.
- **The snapshot column layout is no longer parsed for agent detection**, only
  rewritten (the §11 shell-clamp still applies). The coupling to the resurrect
  column format narrows.

## Refines

- **ADR-0021.** Supersedes the §4 rule ("resume a pane whose `pane_current_command`
  was `claude`/`codex` *and* has a sidecar") with "resume any pane that has a
  sidecar"; obsoletes the Validation note that the rewriter must match the
  ps-derived full-command column. §3 (running-vs-exited is undecidable from the
  agents' session stores) still holds — liveness now comes from the sidecar
  lifecycle, not the snapshot columns. The §11 non-agent shell-clamp is unchanged.
- **ADR-0025.** The AgentStatus schema loses `pid`/`startTime`; the sweep no
  longer reads the status file or the window name to find and probe agents.
- **ADR-0023.** Reinforced: the window name is purely the row label; it is no
  longer a functional input to liveness or resume.

## Status

Accepted.
