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

4. **Use focus to choose the notification channel.** Both notification settings
   support `off`, `windowNotFocused`, and `always`, and both default to
   `always`. The setting still answers when Deck should interrupt; window focus
   answers how. A focused window uses the existing VS Code in-window toast path
   and keeps tab-active suppression. An unfocused window posts a macOS banner
   through `terminal-notifier`, with `-open` pointing at a Deck URI handler that
   opens and reveals the Terminal. NeedsInput banners use the default sound;
   Completed banners are silent. Leaving NeedsInput removes the grouped banner.

   Deck detects `terminal-notifier` once on activation and otherwise silently
   no-ops; non-macOS hosts also no-op. Deck does not bundle `node-notifier` or a
   Mach-O binary: that would add VSIX weight and risk Gatekeeper quarantine for
   a binary the user did not install. `osascript` is not a fallback because it
   has no reliable click action or grouped removal.

5. **Expose Open Terminal only; no Allow action.** A notification can open and
   reveal the Terminal. It does not try to approve a Claude permission prompt.
   Sending keys into a TUI dialog through tmux is brittle and can approve the
   wrong thing if the dialog changes or focus moves.

6. **Reconcile Deck-owned hook entries on activation.** The PRD's earlier
   "upgrade through consent and diff review" path is superseded. Once an agent
   already has Deck hooks, activation compares the config Deck would render for
   this build plus the generated hook script against what is installed. Drift in
   either one triggers the existing backed-up install path, replacing only Deck's
   hook groups and writing the current script in lockstep. The hook command
   string stays stable, so prior consent still applies. Transparency happens
   after the write: Deck shows an informational toast with Review Changes, which
   opens the `.deck.bak` backup against the current config. There is no Revert
   action; uninstalling Deck hooks is the opt-out.

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
- **Suppressing banners when any window is focused** - rejected for now.
  Cross-window focus requires liveness. A stale "focused" heartbeat would
  suppress the OS banner while the user is away, which fails silently. If banner
  redundancy is annoying in practice, add a focused-window heartbeat file:
  focused windows touch it about every 5 seconds, other windows trust it only
  while it is fresher than about 10 seconds, and stale state fails toward
  redundancy.
- **Asking before hook upgrades** - rejected. While consent is pending or
  declined, Deck-owned event lists and scripts can sit mismatched. Reconcile then
  notify keeps Deck's own hook entries internally consistent while preserving the
  backup, Review Changes diff, and uninstall escape hatch.

## Consequences

- **Codex has a parity gap.** Codex Terminals still get agent-aware naming from
  ADR-0023, but no AgentStatus until Codex exposes equivalent lifecycle hooks.
- **Status is best-effort observability, not source-of-truth state.** If a status
  record is missing or stale, Deck prefers to show nothing current rather than
  infer from output.
- **Multi-window notifications can be redundant.** A focused window may show an
  in-window toast while an unfocused window posts an OS banner for the same
  Terminal. The banner group (`deck-<session>`) deduplicates across unfocused
  windows, but Deck deliberately avoids cross-window focused-state suppression
  until it has a liveness mechanism.
- **macOS permission is owned by terminal-notifier.** The first banner can
  trigger a system notification permission prompt for `terminal-notifier`, not
  VS Code.
- **Remote hosts lose OS banners.** If Deck runs over Remote SSH, the
  `terminal-notifier` process runs on the remote host. Deck's tmux model is
  local, so remote OS notification delivery is out of scope.
- **The tree keeps stable Terminal ordering.** Status decorates rows and rolls up
  NeedsInput counts, but it does not sort Terminals.
- **AgentSession resume stays isolated.** Status cleanup, pruning, or parse
  failure cannot break ADR-0021's resume sidecar or TerminalSnapshot restore.
- **Setup prompts stay fresh-install only.** Agents with any Deck hook entries
  are reconciled on activation and are not offered through the setup prompt.

## Status

Accepted — shipped by PRD #90 issues #91-#95 and amended by issues #99 and
#101.
