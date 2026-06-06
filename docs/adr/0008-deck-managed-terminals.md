# ADR-0008: Deck-managed Terminals via a dedicated tmux socket (sanctel-style per-tab sessions)

## Context

Deck today is silent about terminals. Users wire up a per-workspaceFolder
tmux session out-of-band, typically via a `terminal.integrated.profiles.osx`
entry such as `tmux new-session -A -s vscode:${workspaceFolder}` made
default. That gives one tmux session per Worktree on the user's default
tmux socket, with native tmux windows (`prefix c`, `prefix 0/1/3`) as the
unit of "another terminal." It works, but the surface is invisible to Deck:
no per-Worktree list, no `+` affordance from the tree, no UI for "open
the `claude` window in editor view."

We want a vertical list of terminals per Worktree, displayed under the
Worktree node in Deck's existing tree (per ADR-0006's secondary-sidebar
home), with a `+` that creates a new terminal and a click that opens that
terminal in VS Code's editor area attached to a live tmux session.

The hard question is the **model** — what does each row in that list
correspond to in tmux terms?

Alternatives considered:

- **X. Native tmux windows in one base session per Worktree, multi-tab
  via session groups** (`new-session -t <base>`). Matches the screenshot
  the user shared and their current muscle memory (`prefix 0/1/3`).
  Rejected: two editor tabs on the same window of the same group share
  pane content and keystrokes — `prefix [`, `Ctrl-C`, every byte echoes
  in both. Acceptable in a single-user-single-window terminal multiplexer;
  a real footgun in a multi-tab IDE.
- **Z. Hybrid** — native windows, session-group ephemerals per editor tab,
  `select-window` per tab to pin a view. Inherits X's keystroke-sharing
  the moment two tabs land on the same window. Sanctel explicitly rejected
  this model after running into the failure modes in production.
- **Y. Sanctel-style** — each row is its own single-window tmux session,
  named `wt-<sanitized(worktree.path)>__term-N`. Selected. Byte-isolated
  by construction (each editor tab is the only client of its own session);
  the `select-window` problem doesn't exist because there's only one window
  to be on; `+` is `tmux new-session -d -s … -n term-N`; close-tab is
  detach, kill is explicit. The user's "prefix 0/1/3" workflow lives
  *inside* any Deck-managed session if they want it — Deck just doesn't
  enumerate native windows.

The other primary axis is **whose tmux server** Deck talks to. Sharing the
user's default socket would inherit their `~/.tmux.conf`, plugin chrome,
key rebindings, status format, and any session-name collisions with
non-Deck use. We want predictability — Deck's surface should reflect Deck's
state, not the user's whole tmux. Sanctel solved this with `-L sanctel -f
<bundled-conf>`. We adopt the same shape: `-L deck -f resources/deck.conf`.

## Decision

1. **DeckSocket.** All Deck-managed tmux interactions go through a
   dedicated server: `tmux -L deck -f <ext>/resources/deck.conf`. The
   user's default socket (where their existing `vscode:${workspaceFolder}`
   sessions live, if any) is never touched by Deck.

2. **Terminal = single-window tmux session.** Each row in the Deck tree
   is one tmux session on the DeckSocket. Session name is
   `wt-<sanitized(worktree.path)>__term-N` where N is allocated as the
   max existing N for that Worktree's prefix plus one (sanctel's
   `allocate_window_name`). Each session has exactly one window, also
   named `term-N` initially; tmux's `automatic-rename on` then keeps the
   window name aligned with the foreground command (`zsh` → `claude` …).

3. **Display label = `#{window_name}`.** The row's visible label tracks
   the auto-renamed window name (`zsh`, `claude`, …). The N from the
   session name surfaces only as the row's stable numeric prefix
   (`1 zsh`, `3 claude`).

4. **Source of truth = the DeckSocket itself.** Deck does not persist a
   list of Terminals. `tmux -L deck list-sessions -F …` filtered by the
   Worktree's prefix is the canonical query. A `globalState`-backed
   stale-while-revalidate cache (same pattern as ADR-0007) backs instant
   first paint; reality from the next `list-sessions` reconciles it.

5. **Creation is lazy.** No tmux state exists for a Worktree until the
   user clicks `+`. The first `+` creates session+window atomically
   (`new-session -d -s … -n term-1 -c <worktree.path>`) — never a bare
   `new-session`, which leaves a phantom default window that sanctel hit
   in production (sanctel issue #15, encoded in their `ensure_session_window`
   primitive). Subsequent `+` clicks invoke the same primitive with the
   next N.

6. **Attach is direct.** Clicking a row creates a VS Code terminal with
   `shellPath: 'tmux', shellArgs: ['-L','deck','attach-session','-t','=<session>'], location: { viewColumn: ViewColumn.Active }`.
   The leading `=` prevents tmux's prefix matching from binding the wrong
   session. `shellPath` bypasses VS Code's profile resolution entirely —
   the user's `tmux-shell` default profile does not interfere. There is
   no `select-window` step (one window only).

7. **`.show(true)` on click.** Clicking `+` or a row focuses the editor
   terminal. The user's expressed intent is to *use* the terminal.

8. **Re-clicking focuses the existing tab.** Deck maintains a
   per-window `Map<sessionName, vscode.Terminal>`. A click whose session
   already has a live entry calls `.show(true)` on the existing terminal
   instead of opening a second client. Removed from the map on
   `onDidCloseTerminal`.

9. **Reload persistence is free.** Editor-area terminals are restored by
   VS Code's `terminal.integrated.enablePersistentSessions` (default on)
   by re-executing their original `shellPath`+`shellArgs`. Since our
   args are exactly the reattach recipe, the editor tabs reattach to
   their live tmux sessions on reload without any Deck-side restore code.
   Per-workspaceFolder restoration means switching Worktrees correctly
   hides A's terminals while in B and brings them back when switching to
   A — the same property ADR-0003 leverages for tabs/buffers/layout.

10. **Lifecycle.**
    - Close editor tab → tmux client detaches; session persists. Re-click
      reattaches.
    - User runs `exit` in the shell → window dies, session has 0 windows,
      session dies. VS Code's terminal-in-editor tab stays open showing
      exit status (default behavior); user dismisses. Row disappears on
      next Deck refresh.
    - Explicit "Kill Terminal" (right-click) → `tmux -L deck kill-session
      -t =<session>`. No confirmation; tmux can't know about unsaved
      buffer state inside the pane.
    - WorktreeRemoval → before `git worktree remove`, enumerate sessions
      matching the Worktree's prefix and kill each. Idempotent —
      "session not found" is swallowed.
    - ProjectRemoval → same prefix-kill for every known Worktree of the
      Project.

11. **`deck.conf`** ships at `resources/deck.conf`, three lines plus a
    disarm block:
    ```
    set -g automatic-rename on
    set -g history-limit 50000
    set -g destroy-unattached off
    set -g status off
    set -g prefix None
    set -g prefix2 None
    unbind -a -T prefix
    unbind -a -T root
    ```
    Status off because Deck's tree is the UI for windows; prefix removed
    because there is nothing inside a Deck-managed session that tmux
    keymaps would usefully target (one session, one window). `C-b` and
    every other tmux chord pass through to the running program.

12. **Tmux preflight at activation.** One synchronous `tmux -V` call on
    `activate()`. If tmux is absent or older than 3.1 (needed for
    `set -g prefix None`), `deck.tmuxAvailable` context key is `false`;
    the `+` row and all Terminal-related menus gate on it; expanding a
    Worktree shows a single `tmux ≥3.1 not found · install ↗` row.

13. **Refresh on event, not poll.** `list-sessions` fires on: Worktree
    node expanded, after Deck-issued `+`/Kill, `workspaceFolders` change,
    extension activation, view container becomes visible. No periodic
    poll; no tmux hooks. Window-name updates (`zsh` → `claude`) land
    lazily on the next refresh trigger — acceptable, since users look at
    the tree right before they interact with it.

14. **Cross-worktree click.** Clicking a Terminal row whose Worktree is
    not the currently mounted workspace folder records a pending
    "open this session after activation" intent, then runs the existing
    Worktree switch path. The current window reloads into the target
    Worktree; on activation, Deck consumes the intent for that Worktree,
    refreshes that Worktree's terminal-session cache from tmux, and
    dispatches `deck.openTerminal` for the clicked session. Same-Worktree
    Terminal clicks keep attaching directly as before.

15. **Pending terminal-open persistence.** Pending cross-worktree Terminal
    clicks live in `globalState` under `deck.pendingTerminalOpen`:
    `{ schemaVersion: 1, entries: { [worktreePath]: { sessionName,
    createdAt } } }`. `consume(worktreePath)` is read-and-delete: it
    returns the matching session once, removes it, and prunes all entries
    older than 60 seconds on every read. Schema-version mismatch resets
    the store to empty. There is no cross-window collision check; ADR-0008's
    existing multi-window collision note applies.

## Consequences

- **The screenshot's "windows-in-a-session" UX is not what Deck shows.**
  Deck's vertical list looks similar but each row is a *session* in tmux
  terms. Users with strong "prefix 0/1/3" muscle memory will find that
  workflow unreachable inside Deck-managed sessions (no prefix). Their
  pre-existing `vscode:${workspaceFolder}` setup on the default socket is
  untouched and remains a working fallback — explicitly per ADR-0010 if
  one ever exists.

- **Two parallel tmux worlds.** Default socket (user's existing flow)
  and `-L deck` (Deck) coexist forever. The user's terminal-panel `+`
  still spawns `vscode:${workspaceFolder}` via their profile; Deck's
  tree shows only the `-L deck` world. No migration tool.

- **Multi-VS-Code-window collision is acknowledged.** Two VS Code windows
  open on the same Worktree (legal via ADR-0004's DetachedOpen) both see
  the same Deck Terminals. Two users — or one user across two windows —
  clicking the same row both attach to the same single-window session
  and share pane keystrokes. Mitigations were all worse than the bug;
  accepted.

- **Deck.conf changes are breaking for in-flight Terminals.** Editing
  `resources/deck.conf` after release does not reload an already-running
  tmux server (`-L deck` was started with the old conf). Users would
  need to `tmux -L deck kill-server` to pick up changes. Document on
  release notes if/when we change defaults.

- **GC is best-effort, not exhaustive.** If a Worktree directory is
  removed outside Deck (manual `git worktree remove` from the shell),
  the matching `-L deck` sessions stay alive — Deck has no event to
  hook. They're harmless and the user can `tmux -L deck kill-session`
  if they care. We don't sweep.

- **`tmux ≥3.1` becomes a Deck dependency.** Older systems lose the
  Terminals feature but the rest of Deck still works (preflight gates
  the surface).

## Refines

- ADR-0006: the secondary-sidebar tree is where Terminal rows render
  (nested under each Worktree node). The Worktree node becomes
  collapsible while keeping `command` for label-click (SwitchOperation);
  chevron-click expands. Same pattern VS Code's Source Control uses.
- ADR-0007: the same stale-while-revalidate `globalState` cache shape
  applies to the `list-sessions` result; same schemaVersion gating.

## Status

Accepted.
