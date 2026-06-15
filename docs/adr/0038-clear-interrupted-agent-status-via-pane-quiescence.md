# ADR-0038: Clear a stuck InProgress agent status via pane quiescence

## Context

ADR-0025 made **AgentStatus** hook-driven: the agent hook script writes the
status file on lifecycle events, Deck observes it, and absence means "nothing
current to report." ADR-0025 deliberately **rejected** reading the terminal
output ("Pattern matching terminal output, a la tuicommander"), because driving
status from parsed permission/failure copy is prompt-text- and version-coupled
and fails exactly where status matters most.

That leaves one gap: **interrupt and abort fire no hook in either agent.**
Verified on Codex 0.139.0 and Claude Code 2.1.172:

- **Codex interrupt** (Esc mid-turn) → stuck `inProgress` (spinner forever).
- **Codex abort** (Esc on an approval prompt) → stuck `needsInput`.
- **Claude interrupt** (Esc) → stuck `inProgress`; no `Stop`, no `idle_prompt`
  for 2+ min.
- **Claude abort** → stuck `needsInput` (user-reported).

Root cause: the interrupt/abort path never runs the turn-stop hooks (Codex takes
an abort path that never calls `run_turn_stop_hooks`; Claude's `Stop` does **not**
fire on interrupt in 2.1.172), so the status file freezes at its last value. The
agent **process stays alive** at its idle prompt, so the ADR-0031/0033 liveness
sweep is a no-op here — it only removes sidecars for **dead** PIDs. The status
self-heals on the next `UserPromptSubmit`, but until the user prompts again the
sidebar shows a spinner that is actively wrong — and the user looks at the
sidebar precisely when they are *not* prompting.

Field research across eight comparable tools converges cleanly: **every
hook-only tool sticks** (cctop, cmux, hiroppy/tmux-agent-sidebar,
samleeney/tmux-agent-status); **every tool that reads the screen recovers**
(amux, herdr, tuicommander, agent-deck). `herdr` documents this exact gap
("they can miss permission approval results, escape interrupts… for those agents
Herdr still uses screen manifest detection"). The screen-detection tools split
into two mechanisms: **positive UI matching** (herdr matches the approval/working
UI) and **output quiescence / silence timers** (workmux clears a "working" state
when the pane is unchanged for 10s; amux `--settle 2s`; tuicommander ~2.5s).

## Decision

1. **Extend `AgentExitSweep` with an alive-but-idle branch that clears a stuck
   InProgress — status only, never the sidecar.** Today the sweep acts only on a
   **dead** sidecar PID (removes sidecar + restores rename + clears status,
   server-lifetime-gated). The new branch acts on an **alive** agent: for a
   sidecar whose **AgentStatus is `inProgress`**, capture the pane and, if it is
   quiescent for the grace window, **delete the status** (`statuses.remove`). It
   **does not touch the sidecar** — the process is alive and resume-critical.
   This is independent of, and does not contradict, ADR-0033's "sidecar removal
   is the sweep's sole responsibility": that rule governs sidecar lifecycle;
   this clears best-effort observability.

2. **Detect "not working" by output quiescence, not by a per-agent marker.**
   While a turn runs, both agents render continuously-animating working chrome
   (a cycling spinner glyph, plus an incrementing elapsed-time counter on most
   versions). That animation is a heartbeat: a working pane's captured text
   mutates every tick; an interrupted pane freezes instantly. The sweep hashes a
   `capture-pane` of the pane's bottom region; **unchanged across two consecutive
   sweeps (~10s) → not working → clear.** No terminal *copy* is parsed, so the
   mechanism is agent-agnostic — there is no per-agent spinner string to maintain.

3. **Scope the clear to `inProgress`. Leave `needsInput` hook-driven.** A stuck
   `needsInput` (abort on an approval prompt) is **not** cleared by this branch.
   Quiescence cannot distinguish a genuinely-pending permission prompt (static on
   screen, awaiting the user) from an aborted-to-idle one — both lack the working
   chrome. Clearing `needsInput` safely would require **positively matching the
   permission dialog** (herdr's approach), which is precisely the high-churn,
   version-coupled copy ADR-0025 rejected, applied to the state most damaging to
   get wrong. `needsInput` self-heals on the next `UserPromptSubmit`; this matches
   workmux, whose quiescence detection is likewise scoped to the working state
   only.

4. **Clear to absence, not `completed`.** An interrupted turn produced no result,
   so writing `completed`-unread would dangle a blue dot promising output that
   does not exist and would persist until the tab is focused. Absence is
   ADR-0025's defined meaning ("nothing current to report"). A genuine finish
   reaches `completed` via the `Stop` hook *before* quiescence trips, so the
   InProgress-only branch never overwrites a real `completed`.

5. **No staleness gate.** An earlier sketch gated the capture on `statusAt`
   freshness. The quiescence window subsumes it: a freshly hook-set `inProgress`
   cannot be cleared until the pane is unchanged for the full window, and a live
   turn animates immediately, so it never reads as quiescent. The capture cost
   (one `capture-pane` per inProgress pane per ~5s sweep) is negligible. The
   sweep reads `statuses.get(session)` to gate on `inProgress` and tracks its own
   `{hash, firstSeenAt}` per session, dropped when the session leaves `inProgress`.

## Considered Options

- **Accept + document** (rely on the next-`UserPromptSubmit` self-heal, as
  cctop/cmux/hiroppy/samleeney do) — rejected: it leaves a permanently-wrong
  spinner on an idle agent, which undermines the point of AgentStatus.
- **More or different hooks** — rejected: there is no interrupt/abort hook in
  either agent (verified — Codex's abort path never calls `run_turn_stop_hooks`;
  Claude's `Stop`/`idle_prompt` do not fire on interrupt in 2.1.172).
- **Per-agent working-spinner marker** (match `esc to interrupt`) — rejected in
  favour of quiescence: it reintroduces a version-coupled per-agent string;
  quiescence parses no text and is agent-agnostic. Both fail *safe* (a missed
  signal reverts to today's stuck spinner, never a false-clear), but quiescence
  has one fewer surface to maintain.
- **Positive permission-UI matching to also clear `needsInput`** (herdr) —
  rejected: it is exactly ADR-0025's rejected output-copy coupling, on the state
  least safe to clear wrongly (a real prompt the user must still act on).
- **Output quiescence scoped to `inProgress`** — chosen (Decisions 1–3).

## Consequences

- **The stuck-InProgress spinner (interrupt) clears within ~10–15s**, matching the
  recovery the screen-detection tools provide, with hooks still authoritative for
  every status they set.
- **Stuck-`needsInput` after abort remains a known gap**, self-healing on the next
  prompt. Documented here and in the QA notes rather than fixed.
- **New surface:** `tmuxCli.capturePane(session)` (out-of-band `tmux -L deck
  capture-pane`, modelled on `restoreAutomaticRename`); the sweep holds a
  per-session capture-hash tracker; `AgentExitStatusStore` gains a read
  (`get`/equivalent) alongside its existing `remove`.
- **Quiescence rests on the working chrome animating in captured text.** If a
  future agent version renders a *static* working indicator, the clear silently
  stops — failing safe to today's stuck spinner, never a false-clear. Verify the
  animation per agent/version at implementation time (the live tmux repro is the
  check).
- **A truly hung/deadlocked working agent is also cleared** — it is not making
  progress, so this is acceptable.
- **No source-of-truth change.** Status remains best-effort observability
  (ADR-0025); the sidecar remains the liveness/resume source of truth
  (ADR-0031/0033).

## Refines

- **ADR-0025.** Reopens the rejected "Pattern matching terminal output" option,
  **narrowed** to a copy-free, clear-only fallback: quiescence parses no terminal
  copy and only *clears* a stale `inProgress`; hooks remain authoritative for
  setting every status. ADR-0025's objection (prompt-text/version coupling that
  fails on permission/failure copy) does not apply — no copy is read, and the
  permission/failure flows are explicitly left hook-only (Decision 3).
- **ADR-0031 / ADR-0033.** Extends `AgentExitSweep` with an alive-but-idle branch.
  The idle-clear is **status-only and never removes the sidecar**, so ADR-0033's
  "sidecar removal is the sweep's sole responsibility" is intact: sidecar removal
  still happens only on a server-lifetime-gated dead PID.

## Status

Accepted. Implementation pending (issue under PRD #106).
