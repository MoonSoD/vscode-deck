# Deck Context

A VS Code extension that surfaces multiple git repositories' worktrees in one
secondary sidebar view, switches between them by opening one folder at a time,
and gives each Worktree persistent Terminals. (Per-worktree agent chat sessions
are planned.)

## Language

### Repositories & worktrees

**Repository**:
A git repository registered with Deck, identified by its git common dir (the directory all its worktrees share).
_Avoid_: project, folder

**Worktree**:
A `git worktree` entry within a Repository, identified by its filesystem path.
_Avoid_: branch (a Worktree has a branch but is not one)

**Discovery seed**:
The path recorded when a Repository is registered — whichever Worktree was checked out then — used to rediscover the repo, not the Repository's identity.
_Avoid_: repository path

### Selection

**ActiveWorktree**:
The Worktree a Repository currently points at — the one reopened when its Repository node is clicked.
_Avoid_: current branch, checked-out worktree

**ActiveRepository**:
The Repository whose ActiveWorktree is the mounted workspace folder.
_Avoid_: current repo

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

**Terminal**:
A persistent shell owned by Deck — one tmux session on the DeckSocket — shown as a row under a Worktree and opened as an xterm.js editor tab addressed by `deck-terminal:/<worktree>/term-N`.
_Avoid_: tmux session, tmux window, pane

## Relationships

- A **Repository** has many **Worktrees**.
- A **Repository** has one **ActiveWorktree**; the mounted folder has one **ActiveRepository** (or none).
- A **Worktree** hosts zero or more **Terminals**.
- A **Terminal** belongs to exactly one **Worktree** and lives on the one **DeckSocket**.
- A **Switch** changes which **Worktree** is mounted; a **DetachedOpen** does not.

## Example dialogue

> **Dev:** "When I click a different **Worktree**, does it open in a new window?"
> **Domain expert:** "No — that's a **Switch**: it replaces the mounted folder and reloads. Opening in a new window is a **DetachedOpen**, and that one doesn't change the **ActiveWorktree**."
>
> **Dev:** "If I register the same repo from two different worktree paths, is that two **Repositories**?"
> **Domain expert:** "No. A **Repository** is its git common dir, so both resolve to one. The path you registered is just a **discovery seed**."
>
> **Dev:** "Do my **Terminals** die when I **Switch** away?"
> **Domain expert:** "No — they live on the **DeckSocket** and reattach when you return. They die only on Kill, `exit`, or when their **Worktree** or **Repository** is removed."

## Flagged ambiguities

- "delete" conflated removing a **Worktree** with deleting its branch — resolved: **WorktreeRemoval** keeps them separate; branch deletion is opt-in.
- "active" meant both **ActiveRepository** and **ActiveWorktree** — resolved: distinct concepts (the Repository vs the specific Worktree).
- A Repository's registered path was treated as its identity — resolved: it is a **discovery seed**; the git common dir is the identity.
- "tmux session" was used for **Terminal** — resolved: the session is the backing mechanism; **Terminal** is the domain concept.
