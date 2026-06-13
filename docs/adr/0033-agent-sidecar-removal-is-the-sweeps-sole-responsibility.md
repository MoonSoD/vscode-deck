# ADR-0033: Sidecar removal is the sweep's sole responsibility — drop `SessionEnd` removal and the activation prune

## Context

ADR-0031 made an AgentSession resume by keeping a **sidecar** (`{agent,
session_id, pid, startTime}`) and rewriting the TerminalSnapshot at restore.
Three different things could delete a sidecar:

1. The Claude **`SessionEnd` hook** (`rm` the sidecar on a "graceful" Claude end).
2. The **AgentExitSweep** — removes a sidecar when the agent's PID is dead
   (server-lifetime-gated since ADR-0031/#121).
3. The activation **prune** — removes a sidecar whose tmux session is not in the
   live list, once, at startup.

Across five live QA runs, agent auto-resume failed: after `kill-server` (or a
reboot) the sidecars were gone by the time restore ran, so the rewriter clamped
every pane to a bare shell. Two root causes, both confirmed empirically:

- **`SessionEnd` deletes the sidecar on a kill, not just a user quit.**
  `kill-server` (and OS shutdown) send **SIGHUP** to every pane; Claude runs
  `SessionEnd` on the way down, which `rm`'d the sidecar — *exactly when we want
  to resume*. Tested: `SessionEnd`'s `reason` is `prompt_input_exit` on a genuine
  user quit (Ctrl-C twice / Ctrl-D) but **`other`** on a SIGHUP kill; an isolated
  test (`kill-session` on a running Claude) confirmed the sidecar was removed.
  The original justification for `SessionEnd`-removes-sidecar — that it had to,
  because `SessionEnd` also cleared the status and reset the window name, blinding
  the sweep — is **obsolete since #121**, where the sweep began discovering agents
  from the sidecars and reading the PID from the sidecar (not the status/window
  name).

- **Prune races a concurrent or partial restore.** Prune runs in *every* VS Code
  window's activation and keys on a point-in-time `listSessions()`. On a
  multi-window reboot — or a single-window kill-while-open then reload — one
  actor's restore is still mid-flight (partial session list) when another's prune
  runs, so prune deletes the sidecars of sessions not yet recreated.

The sweep (post-#121) already does **all three** cleanup actions on a detected
death — `sidecars.remove`, `restoreAutomaticRename`, `statuses.remove` — gated to
the **current server lifetime** (it never touches a prior-lifetime sidecar,
because that's a resume candidate).

## Decision

1. **Remove the Claude `SessionEnd` sidecar handling entirely.** Drop `SessionEnd`
   from `HOOK_EVENTS_BY_AGENT.claude` and delete its branch from the hook script.
   Claude then runs **no hook on SIGHUP**, so a kill/reboot can never delete a
   sidecar. This also unifies Claude with Codex, which has no `SessionEnd` and has
   always relied on the sweep.

2. **The sweep is the sole sidecar remover, gated on server lifetime.** It removes
   a sidecar only when the agent's PID is dead **and** the sidecar's `startTime`
   is in the current server lifetime. A user-quit agent is detected within one
   sweep interval (~5s); a kill/reboot leaves every (now prior-lifetime) sidecar
   intact for restore. One rule, one place, every agent.

3. **Remove the activation prune of sidecars.** Once the sweep is lifetime-gated,
   a lifetime-gated prune would delete nothing the sweep doesn't already delete,
   and an *un*-gated prune is the multi-window / cross-host wipe race. Prune's only
   unique job was cleaning a sidecar whose session won't be recreated by restore
   (an external `tmux kill-session`, or a session created after the last snapshot
   save). That orphan is harmless — it isn't in the snapshot, so the rewriter has
   no pane to resume, and a reused session name overwrites it — so we accept the
   leak rather than keep a racy remover. (The activation **status** prune is
   dropped with it for the same reason; a leaked status orphan has no tree row to
   decorate.)

## Considered Options

- **Gate `SessionEnd` removal on `reason`** (remove only on `prompt_input_exit`/
  `logout`/`clear`, keep on `other`) — rejected: keeps Claude special, depends on
  the `reason` taxonomy staying correct, and the sweep already covers user-quit.
- **Gate prune on server lifetime** (mirror the sweep) — rejected: it makes prune
  fully redundant with the sweep (same removals), so removing prune is simpler.
- **Cross-window lock around the whole restore** (one window restores+prunes,
  others wait) — deferred: it would additionally make the kill-while-open+reload
  case *resume on the first reload* rather than self-heal on the next, but it's a
  much larger change; the lifetime-gated single-remover design makes every reboot
  **non-destructive**, which is the property that matters.

## Consequences

- **Resume survives `kill-server` / reboot / multi-window reboot.** No path
  deletes a prior-lifetime sidecar, so the rewriter finds the sidecars and injects
  `--resume`. (Verification pending on the real-reboot/cold-open path.)
- **User-quit cleanup is ~5s (sweep tick) for Claude**, matching Codex, instead of
  prompt via `SessionEnd`. Cosmetic lag, no correctness loss.
- **Accepted residuals:** (a) a quit-then-kill within one sweep interval can leave
  a sidecar that resumes once (non-destructive — dead id flashes "session not
  found" → shell); (b) a sidecar whose session is never recreated leaks as a
  harmless unused file. Both are the existing #121 residual class.
- **Hook script changes**, so installed hooks reconcile for every user on next
  activation (`reconcileInstalledHooks` — consented, backed up, diffed).
- **The kill-while-VS-Code-open then reload case still won't resume on the *first*
  reload** (the new host can see another host's partial restore as `restored` and
  skip) — but it is now non-destructive (sidecars survive) and self-heals on the
  next restart. Addressing first-reload-resume needs the deferred cross-window
  restore lock.

## Refines

- **ADR-0031.** Supersedes Decision 4's "Claude graceful quit → the `SessionEnd`
  hook removes the sidecar" — `SessionEnd` is removed; the sweep removes sidecars
  for all agents. The premise that `SessionEnd` must remove the sidecar (it
  blinded the sweep) no longer holds post-#121.
- **ADR-0032.** Unchanged: the restore-state classifier still decides when restore
  runs; this ADR only changes who *removes* sidecars.
- **ADR-0030.** The `RecoveryLock` still guards the wedged-socket reset; a broader
  cross-window restore lock is noted as deferred future work.

## Status

Accepted.
