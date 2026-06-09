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

> **Superseded in part by [ADR-0011](./0011-terminals-as-custom-editor-webviews.md).**
> The Terminal *model* (decisions 1–5, 7, 8, 10–15, and the sessionName
> derivation in 16) carries forward verbatim. The Terminal *surface* —
> decision 6 (attach via `shellPath: 'tmux'`), decision 9 (reload
> persistence via PID-liveness hydration), and the hydration mechanics
> of decision 16 — is replaced by a `CustomEditorProvider` rendering
> xterm.js in a webview, with URI-based identity and native custom-
> editor restoration. See ADR-0011 for the new surface.

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

   > **Update (post-custom-editor):** the numeric prefix was dropped. It
   > existed to identify the tmux session before tabs had a stable identity;
   > the custom-editor URI (`deck-terminal:/<worktree>/term-N`) now carries
   > that identity, so the label is exactly `#{window_name}`. N still drives
   > session naming (`term-N`) and row ordering, but is not displayed.

4. **Source of truth = the DeckSocket itself.** Deck does not persist a
   list of Terminals. `tmux -L deck list-sessions -F …` filtered by the
   Worktree's prefix is the canonical query. A `globalState`-backed
   stale-while-revalidate cache (same pattern as ADR-0007) backs instant
   first paint; reality from the next `list-sessions` reconciles it.

   > **Superseded in part by [ADR-0014](./0014-terminal-rows-from-live-tmux-not-persisted-cache.md):**
   > the `globalState` SWR cache is removed — rows resolve directly from
   > `list-sessions` on every expand/refresh. The headline decision
   > ("source of truth = the DeckSocket; Deck persists no Terminal list") is
   > unchanged, and stronger for it.

5. **Creation is lazy.** No tmux state exists for a Worktree until the
   user clicks `+`. The first `+` creates session+window atomically
   (`new-session -d -s … -n term-1 -c <worktree.path>`) — never a bare
   `new-session`, which leaves a phantom default window that sanctel hit
   in production (sanctel issue #15, encoded in their `ensure_session_window`
   primitive). Subsequent `+` clicks invoke the same primitive with the
   next N.

   > **Superseded in part by [ADR-0019](./0019-reboot-surviving-terminals-via-vendored-tmux-resurrect.md):**
   > Deck now starts the DeckSocket on activation when restoring a
   > TerminalSnapshot after server death. New Terminal creation remains lazy.

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

9. **Reload persistence is hydrated, not free.** VS Code's
   `terminal.integrated.enablePersistentSessions` preserves the pty across
   window reload, so a restored editor tab can still be attached to the
   same Deck tmux session. It does not reliably expose the original
   `shellPath`/`shellArgs` through the extension API after restoration.
   Deck therefore runs an activate-time hydrator that identifies restored
   Deck terminals by tab name plus cwd, verifies their OS PID, and re-links
   matching `vscode.Terminal` objects into the per-window registry before
   pending terminal-open intents are consumed.

10. **Lifecycle.**
    > **Superseded in part by [ADR-0017](./0017-terminals-persist-across-tab-close.md):** close-tab is now non-destructive; TerminalRemoval, shell `exit`, WorktreeRemoval, and RepositoryRemoval destroy Terminals.

    - Close editor tab → tmux session killed; row removed on next refresh.
    - User runs `exit` in the shell → window dies, session has 0 windows,
      session dies. VS Code's terminal-in-editor tab stays open showing
      exit status (default behavior); user dismisses. Row disappears on
      next Deck refresh.
    - Inline X "Close Terminal" → `tmux -L deck kill-session -t =<session>`;
      Deck then disposes the registered editor terminal. No Deck-side
      confirmation; the inline X is a deliberate close.
    - WorktreeRemoval → before `git worktree remove`, enumerate sessions
      matching the Worktree's prefix and kill each. Idempotent —
      "session not found" is swallowed.
    - RepositoryRemoval → same prefix-kill for every known Worktree of the
      Repository.

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

16. **Cross-reload terminal identification.** Restored editor terminals are
    considered Deck-managed only when their name matches `^(\d+)\s+\S+`
    and their `creationOptions.cwd`, after `path.resolve`, equals the
    current workspace folder. The leading `N` and cwd reconstruct the tmux
    session name with the normal `wt-<sanitized(cwd)>__term-N` rule. PID is
    a liveness verifier, stored in `workspaceState` under
    `deck.terminalPids` as `{ schemaVersion: 1, bySession }` whenever Deck
    creates an editor terminal. Activation subscribes to
    `onDidOpenTerminal`, hydrates the current `vscode.window.terminals`
    snapshot, then handles pending cross-worktree open intents. Hydration
    ignores non-Deck or foreign-cwd terminals, disposes tabs whose tmux
    session no longer exists, registers PID-matching restored tabs, swaps a
    later restored tab over an already-registered duplicate only when its
    PID matches, and disposes/recreates unknown or mismatched PID tabs with
    Deck's `tmux -L deck attach-session -t =<session>` args. PID records
    are removed on user-initiated terminal kills and pruned after snapshot
    hydration against live Deck tmux sessions.

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
