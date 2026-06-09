# Deck Context

A VS Code extension that surfaces multiple git repositories' worktrees in one
secondary sidebar view, switches between them by opening one folder at a time,
and gives each Worktree persistent Terminals. (Per-worktree agent chat sessions
are planned.)

## Language

### Repositories & worktrees

**Repository**:
A git repository registered with Deck, identified by its git common dir (the directory all its worktrees share).
_Avoid_: project (a VS Code user reads the open folder as their "project" — that folder is a Worktree), folder

**Worktree**:
A `git worktree` entry within a Repository, identified by its filesystem path.
_Avoid_: branch (a Worktree has a branch but is not one)

**Discovery seed**:
The path recorded when a Repository is registered — whichever Worktree was checked out then — used to rediscover the repo, not the Repository's identity.
_Avoid_: repository path

**ExternalGitWatch**:
The per-Repository file watch on a git common dir that refreshes the Deck tree
when git state changes outside Deck, such as `git checkout` or `git worktree
add/remove`.
_Avoid_: poller, git extension integration

### Selection

**ActiveWorktree**:
The Worktree a Repository currently points at — the one reopened when its Repository node is clicked.
_Avoid_: current branch, checked-out worktree

**ActiveRepository**:
The Repository whose ActiveWorktree is the mounted workspace folder.
_Avoid_: current repo, current project

### Operations

**Switch**:
Replacing the mounted folder with a Worktree's and reloading the window.
_Avoid_: navigate, jump
(implemented as **SwitchOperation**)

**DetachedOpen**:
Opening a Worktree in a new window without changing the current one or the ActiveWorktree.
_Avoid_: new tab, fork

**WorktreeRemoval**:
Removing a Worktree from git, with optional, opt-in deletion of its branch.
_Avoid_: delete (ambiguous between Worktree and branch)

**RepositoryRemoval**:
Delisting a Repository from Deck without touching its git repository or files.
_Avoid_: delete repository, uninstall

**TerminalRemoval**:
Destroying a Terminal — killing its tmux session and removing its row. Surfaced as "Delete Terminal" (right-click or `cmd+backspace`). Also happens when the shell `exit`s or when the Terminal's Worktree or Repository is removed. Closing the editor tab does **not** trigger it.
_Avoid_: close (closing a tab is non-destructive), kill

### Ordering

**RepositoryRegistry**:
The user-curated set and order of registered Repositories.
_Avoid_: repository list, config

**WorktreeOrder**:
The user-curated display order of Worktrees within a Repository.
_Avoid_: sort order

### Terminals

**DeckSocket**:
Deck's own isolated tmux server, separate from the user's personal tmux.
_Avoid_: tmux (the user's own tmux is a distinct thing)

**TerminalSnapshot**:
The capture of every Terminal on the DeckSocket — each one's working directory and scrollback — that lets Terminals survive death of the DeckSocket (reboot, crash, `kill-server`). Saved periodically and restored when Deck next starts.
_Avoid_: backup, session dump

**Terminal**:
A persistent shell owned by Deck — one tmux session on the DeckSocket — shown as a row under a Worktree and opened as an xterm.js editor tab addressed by `deck-terminal:/<worktree>/term-N`. Like a file, the Terminal is the durable thing and its tab is just a view onto it: closing the tab leaves the Terminal running, and any Terminal can be opened from any mounted Worktree without a Switch.
_Avoid_: tmux session, tmux window, pane (the backing mechanism); tab (a disposable view, not the Terminal itself)

## Relationships

- A **Repository** has many **Worktrees**.
- A **Repository** has one **ExternalGitWatch** keyed by its git common dir.
- A **Repository** has one **ActiveWorktree**; the mounted folder has one **ActiveRepository** (or none).
- A **Worktree** hosts zero or more **Terminals**.
- A **Terminal** belongs to exactly one **Worktree** and lives on the one **DeckSocket**.
- A **TerminalSnapshot** captures every **Terminal** on the **DeckSocket**.
- A **Switch** changes which **Worktree** is mounted; a **DetachedOpen** does not.

## Example dialogue

> **Dev:** "I clicked a **Worktree** row and nothing happened — shouldn't it switch?"
> **Domain expert:** "No — a **Worktree** row is folder-like: a click just expands or collapses its **Terminals**. **Switch** is an explicit action in the row's right-click menu — it replaces the mounted folder and reloads. Opening in a new window is a **DetachedOpen**, which doesn't change the **ActiveWorktree**."
>
> **Dev:** "If I register the same repo from two different worktree paths, is that two **Repositories**?"
> **Domain expert:** "No. A **Repository** is its git common dir, so both resolve to one. The path you registered is just a **discovery seed**."
>
> **Dev:** "Do my **Terminals** die when I **Switch** away?"
> **Domain expert:** "No — they live on the **DeckSocket** and reattach when you return. They die only on **TerminalRemoval** (Delete), shell `exit`, or when their **Worktree** or **Repository** is removed."
>
> **Dev:** "And if I reboot my machine — the **DeckSocket** is gone then, right?"
> **Domain expert:** "It dies, but your **Terminals** come back. Deck saves a **TerminalSnapshot** as you work and restores it when it next starts, so each **Terminal** returns at its working directory with its scrollback — picking up a fresh shell prompt. Whatever was *running* is not relaunched."
>
> **Dev:** "So if I close a **Terminal**'s editor tab, is it gone?"
> **Domain expert:** "No — the tab is just a view, like an editor over a file. The **Terminal** keeps running; reopen its row anytime. Destroying it is **TerminalRemoval**."
>
> **Dev:** "What happens when I click a **Terminal** that belongs to a **Worktree** I'm not in?"
> **Domain expert:** "Its tab opens right here in the current window — no **Switch**. Any **Terminal** opens from anywhere, the way you'd open a file."

## Flagged ambiguities

- "delete" conflated removing a **Worktree** with deleting its branch — resolved: **WorktreeRemoval** keeps them separate; branch deletion is opt-in.
- "active" meant both **ActiveRepository** and **ActiveWorktree** — resolved: distinct concepts (the Repository vs the specific Worktree).
- A Repository's registered path was treated as its identity — resolved: it is a **discovery seed**; the git common dir is the identity.
- "tmux session" was used for **Terminal** — resolved: the session is the backing mechanism; **Terminal** is the domain concept.
- "close" conflated closing a **Terminal**'s editor tab with destroying the **Terminal** — resolved: closing the tab is a non-destructive view operation; destroying is **TerminalRemoval** ("Delete"). Reverses ADR-0011 §6's kill-on-tab-close.
- "Project" was the canonical term for a registered repo — resolved: renamed to **Repository** for precision (it is literally a git repo, keyed by common dir). "project" is now avoided because a VS Code user reads the open *folder* as their "project," and that folder is a **Worktree** in Deck.
