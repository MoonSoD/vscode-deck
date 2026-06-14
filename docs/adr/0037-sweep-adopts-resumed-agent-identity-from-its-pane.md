# ADR-0037: The sweep adopts a resumed agent's live identity from its pane

## Context

ADR-0031 made **sidecar presence** the resume signal and the **AgentExitSweep**
the liveness source of truth: the sweep probes each sidecar's stored
`{pid, startTime}` and, on a detected death, removes the sidecar — but only if
the sidecar's `startTime` is in the **current tmux server lifetime**. A
prior-lifetime sidecar is treated as a reboot survivor (a resume candidate) and
kept. ADR-0033 made the sweep the *sole* remover, precisely so a kill/reboot
never deletes a prior-lifetime sidecar before restore can resume it.

That gate assumes a resumed agent **refreshes its sidecar into the current
lifetime**. Claude does — it fires `SessionStart(source: "resume")` on load, and
the hook rewrites the sidecar with the live pid/startTime. **Codex does not.**
ADR-0031 already recorded that `codex resume` fires *no* hook on load (it
rewrites the sidecar only on the next `UserPromptSubmit`); it filed the fallout
as "one harmless resume attempt."

Live QA (resume → quit Codex → `kill-server` + reload) showed it is neither
harmless nor one-shot. The Codex sidecar keeps its **original** launch
`startTime`, which is now prior-lifetime, so the gate keeps it; `codex resume`
succeeds (Codex persists the session on disk), so the agent the user deliberately
quit comes back — and because nothing ever refreshes the sidecar, it **recurs on
every restart**. Claude is immune; the defect is specific to any agent that
doesn't re-register on resume.

The only reliable discriminator between "prior-lifetime sidecar = a survivor
awaiting resume (keep)" and "prior-lifetime sidecar = an agent already resumed
then quit (remove)" is **what is actually alive in the pane now** — the stored
pid is the stale thing.

## Decision

1. **The sweep adopts, it never removes-on-empty.** In the
   *dead-stored-pid + prior-lifetime* branch, the sweep probes the session's
   active pane for a live agent process; if one exists it **re-stamps** the
   sidecar `{pid, startTime}` to that process (adopting it into the current
   lifetime) and keeps it. If the pane has no child, the sidecar is left
   untouched (still a resume candidate). The sweep **never** deletes a
   prior-lifetime sidecar based on an empty pane — that would reintroduce the
   ADR-0033 restore race (the sweep can tick in the gap after restore
   `send-keys` the resume but before the agent has launched).

2. **Removal stays the existing current-lifetime path.** Once adopted, the
   sidecar is current-lifetime with a live pid. When the user quits the agent,
   the next tick sees current-lifetime + dead pid and removes it — the proven
   logic, unchanged. So a resumed-then-quit Codex is now cleaned, and the
   recurrence stops.

3. **Pane identity is resolved by construction, not by name.**
   `pane_pid` (the pane's shell, via `display-message -p #{pane_pid}`) → its
   child (`pgrep -P`) → that child's `ps -o lstart=`. Whatever resurrect
   `send-keys`'d into the restored shell *is* the agent, so the shell's child is
   the agent without inspecting its command name. This deliberately avoids the
   `ps -o command=` match ADR-0031 §5 removed as unreliable (Node rewrites argv
   to a version string). The `lstart` is normalized exactly as
   `serverStartTime` / `AgentLivenessProbe` / the hook normalize it, so the next
   tick's start-time equality holds.

4. **Agent-agnostic; only Codex bites.** The adopt branch is reached only when
   the stored pid is dead. Claude refreshes its sidecar via `SessionStart` within
   seconds of resume, so `isAgentAlive` returns true and the sweep `continue`s
   before reaching the branch. No `if codex` special-casing.

5. **Active pane only.** Deck's contract is one window, one pane per session
   (`TmuxCli`: "one-window-per-session forever"). If the user splits the pane,
   they forfeit this guarantee; we do not list all panes to chase a split.

## Considered Options

- **Make Codex refresh its sidecar on resume (symmetry with Claude)** — rejected:
  Codex emits no `session_id`-bearing hook on `codex resume` load, and the
  failing case is resume-then-quit with no interaction, so no `UserPromptSubmit`
  ever fires. Nothing for a hook to hook; we don't control Codex.
- **Re-stamp at restore (poll the pane after `send-keys`)** — rejected: the agent
  launches asynchronously after the keys land, so it needs a startup-racing
  timeout (guessed per machine), is one-shot with no retry, and adds latency to
  the lock-serialized, user-visible restore. The sweep retries every ~5 s, so it
  catches any launch speed with no timeout to tune.
- **Sweep removes a prior-lifetime sidecar when the pane is a bare shell** —
  rejected: indistinguishable from a survivor not-yet-resumed, so it reintroduces
  the ADR-0033 race. Adopt-only avoids it.
- **Append a cleanup to the resume command (`codex resume <id>; deck-cleanup`)**
  so the shell removes the sidecar on a normal exit but not on a SIGHUP kill —
  rejected: mishandles Ctrl-Z suspend (shell regains control → removes a live
  agent's sidecar), has no sweep backstop if the cleanup line fails, and edits
  ADR-0021's non-destructive resume command.

## Consequences

- **Codex resume-then-quit no longer recurs.** The first sweep tick that observes
  the resumed Codex alive adopts it; the quit is then cleaned by the
  current-lifetime path.
- **Residuals (both the existing #121 class):** (a) if the user resumes and quits
  within one sweep interval (~5 s) before any tick observed it alive, the sidecar
  stays prior-lifetime and resumes once more; (b) if the user quits the agent and
  then runs an unrelated foreground process in the leftover shell, the sweep can
  mis-adopt that process's pid — self-correcting when it exits, with exposure
  only to a spurious resume during a restart while it runs.
- **The sweep gains one tmux read per dead prior-lifetime sidecar per tick**
  (`display-message` + `pgrep` + `ps`), bounded by the count of such sidecars.

## Refines

- **ADR-0031.** Supersedes the Consequences note that a stale resumed-Codex
  sidecar causes only "one harmless resume attempt" — it recurs; the sweep now
  adopts the live identity so the current-lifetime removal can fire. The sidecar
  is still the liveness source of truth; the sweep just learns the resumed
  identity from the pane when the agent didn't re-register.
- **ADR-0033.** Unchanged in spirit: the sweep is still the sole remover and
  still never deletes a prior-lifetime sidecar. Adoption is additive — it
  re-stamps, it does not remove.

## Status

Accepted.
