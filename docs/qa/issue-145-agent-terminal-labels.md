# Manual QA — #145 agent Terminal labels + tab icon (follow-up)

Verifies that an agent Terminal is always identified by its **AgentTitle**, never
by the agent's raw process/window name (e.g. `2.1.172`), across the editor tab
and the sidebar tree — and that this survives while the agent is idle.

- **#145** — the tab **and** tree **label** show the AgentTitle, not the process
  name, even when the tmux window name is a volatile non-agent string.
- **Follow-up (c)** — the editor **tab icon** shows the agent icon (Claude/Codex),
  not the generic terminal glyph, under the same condition.

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

- Deck running from this build: Extension Development Host (`F5`) or an installed
  build of this branch.
- A worktree open with a Deck terminal running **Claude** (or Codex), with at
  least one prompt sent, so the session has an **AgentTitle** (pane title) and an
  **AgentStatus** (written by the agent hooks).
- Note the session name, e.g.
  `wt-_Users_you_code_project__term-1` (`tmux -L deck list-sessions`).

## Scenarios

### 1. Editor tab label (#145)

1. Open the Deck terminal tab running Claude — the tab title shows the AgentTitle
   (the task summary).
2. Force the condition: `tmux -L deck rename-window -t '<session>' 2.1.172`.
3. Click the tab to re-trigger decoration.

- **Expected:** tab title still shows the **AgentTitle**.
- **Pre-fix (fail):** tab title showed `2.1.172`.

### 2. Sidebar tree row label (#145)

1. In **Repositories & Worktrees**, find the terminal row (shows the AgentTitle).
2. With the window renamed to `2.1.172`, let the tree refresh (wait for the
   AgentTitle poll, or collapse/expand the worktree).

- **Expected:** row label still shows the **AgentTitle**, not `2.1.172`.

### 3. Idle survival (#145 core)

1. With the window renamed to `2.1.172`, leave the agent **idle** — do not type in
   it, run nothing in the pane.
2. Switch to another tab and back; wait a minute.

- **Expected:** the label stays correct indefinitely — it does not depend on tmux
  re-reading the process name.
- **Pre-fix (fail):** stayed stuck on `2.1.172` forever.

### 4. Editor tab icon (follow-up c)

1. With the window renamed to `2.1.172`, focus the terminal tab.

- **Expected:** the tab icon is the **Claude** (or Codex) icon.
- **Pre-fix (fail):** the tab icon was the generic terminal glyph.

### 5. No regression for plain shells (control)

1. Open a Deck terminal that is **not** an agent (a plain shell — one where you
   never ran an agent; `pane_current_command` is e.g. `zsh`).

- **Expected:** tab/row label is the **window name** (e.g. `zsh`) and the tab icon
  is the generic terminal glyph. A plain shell has no AgentStatus/sidecar, so it
  must keep window-name behavior — the fix must not turn every terminal into an
  "agent".

## Cleanup

Re-enable automatic naming for the window (or just run any command in the pane,
which makes tmux re-derive the name):

```sh
tmux -L deck set-option -w -t '<session>' automatic-rename on
```
