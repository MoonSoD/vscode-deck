# ADR-0025: Agent status via hooks

## Context

ADR-0021 made an **AgentSession** survive reboots by observing Claude Code and
Codex session ids through hooks and rewriting the **TerminalSnapshot** on
restore. ADR-0023 then used the same hook path to name a **Terminal** `claude`
or `codex`, but it deliberately stayed identity-only: a row could say which
agent occupied the Terminal, not whether the agent was working, blocked on a
permission prompt, finished, or failed.

The feature shipped in PRD #90 closes that observability gap for Claude Code
agents. Deck surfaces an **AgentStatus** on Terminal rows, rolls actionable
NeedsInput counts up to collapsed Worktree and Repository rows, badges the Deck
view, and notifies on NeedsInput transitions. This ADR records the shipped
decisions from issues #91-#95.

## Decision

1. **Use hooks-only detection.** AgentStatus is observed from Claude Code hook
   events. Deck does not parse terminal output and does not watch transcripts.
   This is Claude-only v1; Codex keeps ADR-0023 identity-only naming because it
   lacks the hook parity needed for equivalent status.

2. **Adopt the VS Code ChatSessionStatus model with read/unread metadata.** The
   statuses are InProgress, NeedsInput, Completed, and Failed, with absence
   meaning nothing current to report. Read/unread is metadata on Completed, not
   another status. Completed starts unread and becomes read when the Terminal tab
   is focused, matching VS Code's agent-sessions behavior.

3. **Use a separate disposable status file, not the AgentSession resume data.**
   Status is high-churn and disposable. The AgentSession sidecar from ADR-0021
   remains the resume-critical sidecar and is written before status work. Losing
   status must never prevent a TerminalSnapshot from resuming an AgentSession.

4. **Use VS Code-shaped notification settings with Deck-specific defaults.**
   Both notification settings support `off`, `windowNotFocused`, and `always`,
   but the defaults intentionally differ from VS Code: `always` for NeedsInput
   and `off` for Completed. VS Code extensions get in-window toasts, not OS
   toasts or dock/taskbar attention, so a focused-window toast for a background
   Terminal is useful. Completed remains ambient by default through the unread
   dot.

5. **Expose Open Terminal only; no Allow action.** A notification can open and
   reveal the Terminal. It does not try to approve a Claude permission prompt.
   Sending keys into a TUI dialog through tmux is brittle and can approve the
   wrong thing if the dialog changes or focus moves.

## Considered Options

- **Pattern matching terminal output, a la tuicommander** - rejected. It is
  prompt-text coupling, agent-version coupling, and fails exactly where status is
  most valuable: permission and failure flows that can change copy.
- **Transcript watching** - rejected. It couples Deck to per-agent storage
  internals and still trails the live TUI state.
- **tmux user options as the status transport** - rejected. User options are a
  durable tmux configuration surface, not a disposable high-churn status feed,
  and would blur ADR-0022's curated user-option boundary.
- **Extending the AgentSession sidecar** - rejected. The sidecar is
  resume-critical state. Mixing high-churn status into it increases write risk
  on the restore path and makes cleanup semantics ambiguous.
- **Allow/approve from the notification** - rejected. It would require tmux
  send-keys into Claude's interactive permission UI, which Deck cannot make
  robust.

## Consequences

- **Codex has a parity gap.** Codex Terminals still get agent-aware naming from
  ADR-0023, but no AgentStatus until Codex exposes equivalent lifecycle hooks.
- **Status is best-effort observability, not source-of-truth state.** If a status
  record is missing or stale, Deck prefers to show nothing current rather than
  infer from output.
- **Multi-window notifications can leave a stale toast.** Each VS Code window
  observes transitions independently. A NeedsInput toast in one window can remain
  after the user handles the prompt from another window, but clicking it still
  opens the Terminal, which is safe.
- **The tree keeps stable Terminal ordering.** Status decorates rows and rolls up
  NeedsInput counts, but it does not sort Terminals.
- **AgentSession resume stays isolated.** Status cleanup, pruning, or parse
  failure cannot break ADR-0021's resume sidecar or TerminalSnapshot restore.

## Status

Accepted — shipped by PRD #90 issues #91-#95.
