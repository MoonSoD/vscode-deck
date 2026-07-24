# ADR-0053: Claude VS Code extension sessions as ChatSessions

## Status Accepted

## Context

Deck shows a Worktree's **Terminals** and observes any **AgentSession** running
inside one. The Claude Code **VS Code extension** is a second surface: it runs
Claude Code as an editor webview ("a window"), independent of any Terminal. Users
asked for those windows to appear under their Worktree the way Terminals do, with
the same needs-input / finished awareness.

The extension exposes no consumable API, and a webview tab reveals almost nothing
to other extensions: `vscode.window.tabGroups` gives a tab's `viewType` and a
(truncated) `label`, but no session id, no working directory, and only for the
current window. The durable source of truth is on disk — Claude Code writes every
session to `~/.claude/projects/<cwd-with-non-alphanumerics-as-dashes>/<id>.jsonl`,
each line carrying `cwd`, `gitBranch`, an evolving `aiTitle`, and — critically —
an `entrypoint` (`claude-vscode` for the extension, `cli` for terminal/CLI runs).

## Decision

1. **Model it as a ChatSession, distinct from an AgentSession.** A ChatSession is
   a Claude conversation the extension surfaces as a window, belonging to a
   Worktree, shown as its own row alongside Terminals. Deck only observes and
   reveals it; it never owns the window's lifecycle. This is the "per-worktree
   agent chat sessions" the intro reserved, kept separate from AgentSession (an
   agent observed *inside* a Terminal).

2. **Discover from disk, not from tabs.** Scan `~/.claude/projects`, keep sessions
   whose `entrypoint` is `claude-vscode` and whose file was modified within the
   last two days, and place each under the Worktree that is the longest path
   prefix of its `cwd` (a cwd may be a subdirectory of its Worktree). Filtering on
   `entrypoint` keeps a Terminal's own `cli` agent from being listed twice. A
   modification-time gate keeps the scan cheap; a recursive watch on the projects
   directory drives refreshes — the ChatSession counterpart to how AgentStatus is
   watched.

3. **Reveal through the extension; stay worktree-aware.** Opening hands the
   session id to `claude-vscode.editor.open`. A session resumes only within its
   own Worktree — the extension runs `claude --resume` in the mounted workspace
   folder, and Claude Code scopes sessions by project, so resuming another
   Worktree's session in this window yields a blank conversation (verified:
   `claude --resume=<id>` from the wrong folder returns "No conversation found").
   So a same-Worktree session is revealed in place; a cross-Worktree one opens
   that Worktree's window and is resumed there.

4. **Queue cross-window opens through a watched file, not globalState.** The open
   is written to `<deckDir>/pending-chat/<worktree>.json` and consumed by the
   window mounted on that Worktree, on activation (fresh window) and on focus
   (VS Code focuses an already-open folder window rather than duplicating it). A
   watched file is used because globalState is cached in memory per window, so an
   already-running window would never observe a new entry. Entries expire by TTL.

5. **ChatSessionStatus reuses the AgentStatus machinery.** The same installed
   Claude Code hook, when it fires with no `DECK_SESSION` but
   `CLAUDE_CODE_ENTRYPOINT=claude-vscode`, writes a status file keyed by the agent
   session id under `<deckDir>/chat-status/`. A second AgentStatusStore over that
   directory drives the same working icon, attention decoration (a new `chat`
   decoration kind), and NeedsInput/Completed toast a Terminal gets. Read state
   clears when the session's tab is the focused window's active tab, matched by
   title — the same signal used to badge an open session with a green dot.

6. **Open state is cross-window via a shared registry; closed sessions are
   hidden by default behind a toggle.** Because a window sees only its own tabs,
   each window publishes the Claude chat titles it has open to
   `<deckDir>/open-chat/<windowId>.json` and every window reads the union
   (`OpenChatWindowStore`) — the same watched-directory pattern as `pending-chat`
   and `chat-status`. So a session open in another window is recognised as open,
   not only one running (via ChatSessionStatus) or open in this window. An entry
   is kept fresh by a heartbeat and removed on the window's dispose, so a stale
   file (a crashed window) expires by TTL rather than pinning a session open. The
   list then defaults to the live sessions only: the `deck.showClosedChatSessions`
   setting (off by default) hides recent-but-closed rows, toggled from the view's
   title bar (an eye / eye-closed button swapped by a context key that mirrors the
   setting). The tree filters on the same open signal that badges the green dot.

## Consequences / known limits

- **Open state is title-matched; read-clearing stays current-window only.** A
  tab exposes only its (truncated) label, so open state matches by title prefix
  and identical titles could still cross over — the residual limit the shared
  registry can't remove, since no session id is available off a tab. The
  registry does make open state cross-window (decision 6), so a session open in
  another window is no longer missed; a running session (via ChatSessionStatus)
  is marked live regardless. Read-clearing still keys off the focused window's
  active tab, so it remains current-window.
- **ChatSession attention does not roll up to a collapsed ancestor.** The leaf
  row shows its dot; unlike Terminals it does not yet bubble to a collapsed
  Worktree/Repository.
- **ChatSessionStatus needs the updated hook.** Existing installs must reinstall
  agent hooks once before extension windows emit status.
