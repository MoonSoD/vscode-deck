# Manual QA — #145 + #146: agent Terminal labels & icons

Verifies that an agent Terminal is always identified by its **AgentTitle**, never
by the agent's raw process/window name (e.g. `2.1.172`), across the editor tab and
the sidebar tree — label **and** icon — and that this survives while the agent is
idle.

- **#145** — the tab **and** tree **label** show the AgentTitle, not the process
  name, even when the tmux window name is a volatile non-agent string.
- **#145 follow-ups** — the **editor tab icon** and the **sidebar tree-row icon**
  show the agent icon (Claude/Codex), not the generic terminal glyph, under the
  same condition. (The tree-row icon needed a separate fix because the *rendered*
  icon was computed independently from the label.)
- **#146** — the tree row now resolves its icon **once** (both the rendered icon
  and the change-detection signature come from one resolution). This is
  behavior-preserving; scenario 4b below is what validates it stays correct.

All fixes are merged to `main`.

## How the bug triggers (and how to force it on demand)

The label/icon break when the tmux **window name** is not exactly `claude`/`codex`
while the session is a running agent. Claude causes this in the wild by briefly
renaming its own OS process to its version string; `automatic-rename` copies that
into the window name. In an idle pane tmux never re-reads it, so it stays stuck.

To reproduce deterministically, rename the window yourself:

```sh
tmux -L deck list-sessions                                  # find the session name
tmux -L deck rename-window -t '<session-name>' 2.1.172      # simulate the process rename
```

A manual rename also disables `automatic-rename` for that window, so the wrong
name persists — this is exactly the "stuck / does not recover" case.

## Preconditions

- **Fix build:** from the `vscode-deck` repo (on `main`), press **`F5`** → "VS Code
  Extension Development". The published Deck is disabled in the Dev Host; the
  `main` build (with the fixes) loads instead.
- **Pre-built sandbox:** `~/code/deck-qa` (see its `QA.md`) provides three
  worktrees with terminals already created on the `deck` tmux server:
  - `main` → agent (Claude), session
    `wt-_Users_almeynman_code_deck-qa__term-1` — **pre-forced to `2.1.172`**, ready
    to verify.
  - `feature/alpha` → agent (Claude), normal window name — baseline.
  - `feature/beta` → plain shell — the no-regression control.
- Open `~/code/deck-qa` in the Dev Host to see them.

The agent terminals carry an agent **sidecar** (`~/.local/share/deck/hooks/…json`),
the stable identity signal the fix reads; they have no status file (idle), so they
exercise the **sidecar fallback** path — the idle case #145 is about. Their
AgentTitle is the default `Claude Code` (no prompt sent); send a prompt if you want
a more distinctive title.

## Scenarios

Use the pre-forced `main` agent (`…deck-qa__term-1`, already `2.1.172`). To re-arm
after it recovers, re-run the `rename-window … 2.1.172` command above.

### 1. Editor tab label (#145)

1. Open the agent's terminal tab; click it to trigger decoration.

- **Expected:** tab title shows the **AgentTitle** (`Claude Code`).
- **Pre-fix (fail):** tab title showed `2.1.172`.

### 2. Sidebar tree row label (#145)

1. In **Repositories & Worktrees**, find the terminal row (let the tree refresh —
   `Deck: Refresh`, or collapse/expand the worktree).

- **Expected:** row label shows the **AgentTitle**, not `2.1.172`.

### 3. Idle survival (#145 core)

1. Leave the agent idle (don't type in it, run nothing in the pane). Switch tabs
   and back; wait a minute.

- **Expected:** the label stays correct indefinitely — no dependence on tmux
  re-reading the process name.
- **Pre-fix (fail):** stayed stuck on `2.1.172` forever.

### 4. Editor tab icon

1. Focus the terminal tab.

- **Expected:** the tab icon is the **Claude** (or Codex) icon.
- **Pre-fix (fail):** the tab icon was the generic terminal glyph.

### 4b. Sidebar tree-row icon (also validates #146)

1. Run **`Deck: Refresh`** to force the tree to re-render the row.

- **Expected:** the row keeps the **Claude** (or Codex) mark.
- **Pre-fix (fail):** the row icon reverted to the plain terminal glyph — this bit
  hardest for a **sidecar-only** agent (idle, no status file), where the rendered
  icon had no AgentStatus to fall back on once the window name went volatile. #146
  ensures this rendered icon and the row's change-detection signal come from the
  same single resolution, so they can't drift apart again.

### 5. No regression for plain shells (control)

1. Look at the `feature/beta` terminal row (a plain shell — no agent, no sidecar).

- **Expected:** label is the **window name** (e.g. `zsh`) and the icon is the
  generic terminal glyph. A plain shell must keep window-name behavior — the fix
  must not turn every terminal into an "agent".

## Cleanup

Re-enable automatic naming for a window you renamed (or just run any command in the
pane, which makes tmux re-derive the name):

```sh
tmux -L deck set-option -w -t '<session>' automatic-rename on
```

Tear down the whole sandbox when done: `~/code/deck-qa/qa-teardown.sh`.
