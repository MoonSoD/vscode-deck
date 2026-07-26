# Deck Context

A VS Code extension that surfaces multiple git repositories' worktrees in one
secondary sidebar view, switches between them by opening one folder at a time,
and gives each Worktree persistent Terminals. It also surfaces each Worktree's
Claude ChatSessions — the windows the Claude VS Code extension opens — as rows
under that Worktree.

## Language

### Repositories & worktrees

**Repository**:
A git repository registered with Deck, identified by its git common dir (the directory all its worktrees share).
_Avoid_: project (a VS Code user reads the open folder as their "project" — that folder is a Worktree), folder

**Worktree**:
A `git worktree` entry within a Repository, identified by its filesystem path. Usually on a branch, but may be a **Detached Worktree** (checked out at a commit with no branch — shown, labelled by folder name + short commit) or a **Bare Worktree** (no working tree at all — Deck hides it, since it cannot be mounted).
_Avoid_: branch (a Worktree usually has a branch but is not one; a Detached Worktree has none)

**Discovery seed**:
The path recorded when a Repository is registered — whichever Worktree was checked out then — used to rediscover the repo, not the Repository's identity.
_Avoid_: repository path

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

**UnmergedCommits**:
Commits on a Worktree's branch that branch deletion would orphan — work git cannot confirm is merged or pushed anywhere else. The risk concept that gates branch deletion in WorktreeRemoval. Detected reactively by git's own safe-delete refusal (an over-cautious approximation: squash-merged and stale-remote branches also trip it), never by an upfront warning — a warning that fires on routine squash-merged branches would train click-through on the destructive path.
_Avoid_: unpushed commits (measured against `@{u}`; silently absent when the branch has no upstream — the wrong guard for branch deletion), unmerged branch (the commits are at risk, not the ref)

**KeptBranch**:
The outcome when WorktreeRemoval's opt-in branch deletion is refused over UnmergedCommits: the Worktree is gone, the branch survives, and a toast says so in Deck's words with a Force Delete Branch action. The force action is guarded by the branch tip recorded at refusal — if the branch has moved since (the toast may be clicked hours later from the notification center), Deck asks the user to review instead of deleting.
_Avoid_: failed deletion (the safe outcome is working as designed, not an error), orphaned branch (nothing is orphaned — that is the point)

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
The user-curated display order of Worktrees within a Repository, overlaid on a default of **creation order** (newest last) with the main Worktree pinned first. Like TerminalOrder it stores order without owning existence — reconciled against the live `git worktree list`, so an uncurated Worktree falls to its creation-order slot, not an alphabetical one.
_Avoid_: sort order, alphabetical order (the default is by creation, not name)

**TerminalOrder**:
The user-curated display order of Terminals within a Worktree. An order overlay reconciled against the live tmux list — tmux owns which Terminals exist; this owns only their order. Absent it, Terminals fall back to ascending `term-N` order.
_Avoid_: terminal list (it stores order, not existence — cf. ADR-0014), sort order

### Terminals

**DeckSocket**:
Deck's own isolated tmux server, separate from the user's personal tmux.
_Avoid_: tmux (the user's own tmux is a distinct thing)

**TerminalSnapshot**:
The capture of every Terminal on the DeckSocket — each one's working directory, scrollback, and the AgentSession it was running (if any) — that lets Terminals survive death of the DeckSocket (reboot, crash, `kill-server`). Saved periodically and restored when Deck next starts.
_Avoid_: backup, session dump

**AgentSession**:
The resumable AI-agent conversation (Claude Code or Codex) a Terminal was running, identified by the agent's own session id. Deck only *observes* it — the user starts the agent — and captures it in the TerminalSnapshot so that on restore the Terminal relaunches the agent (`claude --resume` / `codex resume`) instead of returning to a bare shell. Discovered via a Deck hook installed in the agent's config, keyed to the Terminal by an injected `DECK_SESSION` env var.
_Avoid_: agent chat session (implies a separate chat surface; this is an attribute of a Terminal), conversation, thread, agent process

**AgentStatus**:
The observed status of an AgentSession in a Terminal: InProgress, NeedsInput,
Completed with unread metadata, or Failed. Absence means there is nothing current
to report. Deck observes it through agent hooks; it does not own or infer the
agent lifecycle.
_Avoid_: busy, done, agent state, terminal status (the Terminal itself can be healthy while the agent is blocked), process status

**AgentTitle**:
The task summary an agent's TUI publishes for its Terminal (e.g. Claude's
"Reconcile Datadog monitors"), surfaced as the Terminal's row and tab label so
concurrent agents are distinguishable. Deck only observes it — read from the
running agent and cleaned of the agent's leading status glyph — and keeps the
agent *identity* (which drives the icon) as a separate marker, so a stale or
default title never confuses which agent it is. Absent or default title falls
back to the agent identity name.
_Avoid_: window name / tab title (those are the surfaces it is shown on, not the observed summary), terminal name

**AgentStatusNotification**:
The toast Deck raises when a Terminal's AgentStatus changes to NeedsInput or Completed, naming the agent by the labels the user already reads in the tree — Repository, Worktree branch, AgentTitle — followed by the agent's own ask, with an Open Terminal action. Identity leads so the line stays legible when the toast collapses to one ellipsised line. A ChatSession raises the same toast (with an Open action) on its ChatSessionStatus.
_Avoid_: alert, popup; "agent needs input"/"agent done" alone (unactionable without identity)

### Claude chat sessions

**ChatSession**:
A Claude Code conversation the Claude VS Code extension surfaces as its own editor **window** (a webview), belonging to a Worktree and shown as a row under it alongside Terminals. Deck discovers it from the on-disk Claude session store (the sessions whose entrypoint is the VS Code extension), lists the recent ones (touched within the last two days) plus any open right now — a green dot marks the live ones — and opens or reveals it by handing its id to the extension. A session is **live** when its window is open in any VS Code window (each window publishes its open titles to a shared registry, so open state is cross-window, not just this window's tabs) or its agent is running; the recent-but-**closed** ones are hidden by default and revealed by the `deck.showClosedChatSessions` toggle in the view's title bar. Deck only observes and reveals it; it never owns the window's lifecycle. Unlike an AgentSession it has no Terminal and no tmux session, and it resumes only within its own Worktree, so Deck opens one that belongs to another Worktree by offering to open that Worktree in a new window rather than resuming it blank in the wrong folder.
_Avoid_: AgentSession (that is an agent observed running *inside* a Terminal; a ChatSession is a standalone window with no Terminal), Terminal (no tmux session, not persisted by Deck), tab (the window is the durable thing Deck reveals, not a Deck-owned tab), Claude window (name the concept, not its surface)

**ChatSessionStatus**:
The observed status of a ChatSession — the same InProgress, NeedsInput, Completed (with unread metadata), and Failed vocabulary as AgentStatus, with absence meaning nothing to report. Observed through the same Claude Code hook, which keys it by the agent's own session id when it fires outside a Terminal (no DECK_SESSION) for a VS Code extension window. It drives the ChatSession row's working icon and attention decoration and raises the notification, mirroring what a Terminal's AgentStatus does.
_Avoid_: AgentStatus (that is a Terminal's status; ChatSessionStatus is a window's — same shape, different subject), busy/done/agent state

**TerminalLauncher**:
A user-defined command that opens a new Terminal and runs in it. Sourced from three places merged in a Quick Pick behind a Worktree row's launch button: a per-repo committed file (`<worktree>/.deck/launchers.json`), the user-local RepositoryLaunchers for that Repository, and global user settings (`deck.terminalLaunchers`) — committed-repo entries shown first, then repository-local, then global. Deck types the command into a fresh Terminal exactly as the user would, so a launcher that runs an agent is observed and resumed by the existing AgentSession machinery — Deck still does not own the agent lifecycle. A launcher carries a single command; sequence steps with `&&` (which also fails fast); run several in parallel by defining several launchers.
_Avoid_: agent preset (no prompt templates/transports — it is just a command), task (VS Code tasks are a separate system), button (the surface is one row button opening a Quick Pick, not a button per launcher — VS Code cannot render per-row dynamic menu buttons)

**RepositoryLaunchers**:
The user-local TerminalLaunchers for one Repository, authored in user settings (`deck.repositoryLaunchers`, an array of `{ repository, launchers }` entries keyed by the registered Repository path) rather than committed to the repo — for launchers that are personal to one Repository but should not live in its `.deck/launchers.json` (e.g. `claude`, a personal bootstrap). They are config keyed by Repository identity, **not** a registration: an entry whose path matches no registered Repository is inert, and editing it never adds, removes, or reorders a Repository in the RepositoryRegistry. Resolved by common dir, so it applies to every Worktree of the Repository.
_Avoid_: project launchers (it is per-Repository — "project" is a Worktree to a VS Code user), workspace launchers (not VS Code workspace settings — those are per-Worktree and committable), local .deck (it is settings, not a repo file)

**RunOnWorktreeCreate**:
A TerminalLauncher flag (`runOnWorktreeCreate: true`) that makes Deck fire that launcher automatically — headless, no editor tab — when a Worktree is created through Deck's Add command, turning launchers into per-worktree bootstrap (e.g. `mise install && pnpm bootstrap` in one, `claude` in another). Honored in all three launcher sources; only Deck-created Worktrees trigger it — worktrees created on the CLI and merely discovered by ExternalGitWatch, including every worktree seen when a Repository is registered, do not.
_Avoid_: post-create hook (it is launcher data, not a script Deck owns), provisioning script, autorun (ambiguous about which event)

**Terminal**:
A persistent shell owned by Deck — one tmux session on the DeckSocket — shown as a row under a Worktree and opened as an xterm.js editor tab addressed by `deck-terminal:/<worktree>/term-N`. Like a file, the Terminal is the durable thing and its tab is just a view onto it: closing the tab leaves the Terminal running, and any Terminal can be opened from any mounted Worktree without a Switch. Its Worktree is fixed when it is created and never changes — a Terminal cannot move to another Worktree or Repository.
_Avoid_: tmux session, tmux window, pane (the backing mechanism); tab (a disposable view, not the Terminal itself)

**DisconnectedTab**:
A Terminal tab whose view outlived the extension host that wired it. This happens when the extension host restarts without a full window reload, such as an extension update or Developer: Restart Extension Host. The Terminal itself is still healthy on the DeckSocket, but the tab keeps showing its last scrollback while keystrokes and output no longer cross the dead webview bridge. VS Code does not re-resolve that surviving custom-editor input, so Deck can only repair it by closing and reopening the tab. Deck marks a tab as a DisconnectedTab only after evidence: the tab is active in its group and still has no registered panel after a grace period. The mark is a grey `!` FileDecoration on the `deck-terminal:` URI and a Reopen Terminals action; Deck never reopens tabs without user consent.
_Avoid_: dead tab (the Terminal did not die), stale tab (the defect is lost interactivity, not just old content), broken terminal (the Terminal is healthy)

### Previews

**DeckBrowser**:
Deck's own set of isolated Chrome instances — one `--user-data-dir` and `--remote-debugging-port` per Worktree — the browser analog of the DeckSocket. Deck lists, reveals, and closes windows over the Chrome DevTools Protocol's HTTP endpoints.
_Avoid_: the user's own Chrome (a distinct thing; DeckBrowser profiles are Deck-managed and isolated), integrated browser (VS Code's Simple Browser — DeckBrowser opens real Chrome windows).

**PreviewWindow**:
A real Chrome window Deck owns, bound to one Worktree + PreviewDefinition, showing that preview's deterministic URL as a chromeless `--app` window. Shown as a row under a Worktree beside Terminals and ChatSessions; clicking opens it, or reveals it if already open. Like a Terminal it is the durable thing (its Chrome profile persists on disk), but unlike a Terminal, Chrome — not Deck — keeps it alive across reloads.
_Avoid_: tab, webview, integrated browser (it is an OS Chrome window, not a VS Code panel); Simple Browser.

**PreviewDefinition**:
A user-declared named preview (name, base port, optional env var and URL path) — the data behind a PreviewWindow row. Sourced exactly like a TerminalLauncher and merged from three places (committed `<worktree>/.deck/previews.json`, per-Repository `deck.repositoryPreviews`, global `deck.previews`), deduped by name.
_Avoid_: launcher (it declares a browsable surface, not a command to run), preset.

**PreviewPort**:
The deterministic port Deck derives per Worktree + PreviewDefinition — the definition's base plus a stable per-Worktree slot (a hash of the Worktree path, mirroring the tmux session-name derivation). Used both to form the PreviewWindow URL and, injected as an env var into the Worktree's Terminals, to make the dev server bind the same port — so browser and server agree with no handshake.
_Avoid_: dev server port (the server binds it because Deck told it to; the port is Deck's, derived from the Worktree), random port.

**BrowserPoll**:
The focus-gated ~2s poll that observes which PreviewWindows are live — listing each Worktree instance's CDP targets and matching them to PreviewDefinitions by PreviewPort — and drives the "open" badge. The DeckBrowser's counterpart to the TerminalPoll; a poll, not a CDP event client (ADR-0052, ADR-0054).
_Avoid_: CDP event client (Deck polls, not subscribes), browser watcher.

### External changes

**ExternalGitWatch**:
Watches a Repository's git common dir for changes made **outside** Deck (e.g. a terminal `git checkout`, or `git worktree add/remove` from the CLI) and tells the tree to reconcile. One per Repository, keyed by common dir. Deck's own operations already refresh, so this exists solely to catch out-of-Deck drift.
_Avoid_: file watcher, watcher controller (implementation); polling (it is event-driven, not polled)

**ExternalTerminalWatch**:
Watches the DeckSocket for Terminals created or killed **outside** Deck (e.g. an agent running `tmux new-session` from the CLI) and tells the tree to reconcile. Deck's own operations already refresh, so this exists solely to catch out-of-Deck drift. Realized by the TerminalPoll's session-set diff (≤2s while the window is focused) plus a refresh on window refocus — not tmux control-mode events, which would require a housekeeping session (ADR-0052). External creation is a supported contract: a session created on the DeckSocket with Deck's name grammar, `-e DECK_SESSION=<name>`, and `-c <worktree>` is a full Terminal — agent observation and snapshot resume included; a session missing the extra flags still appears, just without agent features.
_Avoid_: tmux watcher (it watches for Terminals, the domain thing); session sync (it only triggers reconcile; tmux stays the source of truth)

**TerminalPoll**:
The one poll that observes Terminals on the DeckSocket — a 2s `list-sessions` tick, running only while the window is focused. It carries two facets: AgentTitle relabels for existing rows (targeted, ADR-0046) and the session-set diff that realizes ExternalTerminalWatch (whole-tree, structural). Formerly named AgentTitlePoll, when titles were its only job.
_Avoid_: AgentTitlePoll (stale name — titles are now one facet); background sync (it is focus-gated and owns no state; tmux stays the source of truth)

## Relationships

- A **Repository** has many **Worktrees**.
- A **Repository** has one **ExternalGitWatch** keyed by its git common dir.
- The **DeckSocket** has one **ExternalTerminalWatch**, realized by the **TerminalPoll**'s session-set diff.
- A **Repository** has one **ActiveWorktree**; the mounted folder has one **ActiveRepository** (or none).
- A **Worktree** hosts zero or more **Terminals**.
- A **Terminal**'s AgentStatus change to NeedsInput/Completed raises one **AgentStatusNotification**.
- A **Terminal** belongs to exactly one **Worktree** and lives on the one **DeckSocket**.
- A **Worktree** hosts zero or more **ChatSessions** — its recent Claude VS Code extension windows — shown alongside its **Terminals**.
- A **ChatSession**'s **ChatSessionStatus** change to NeedsInput/Completed raises one **AgentStatusNotification**.
- A **Worktree** row offers its Repository's **TerminalLaunchers** from three sources: the worktree's committed `.deck/launchers.json`, the Repository's user-local **RepositoryLaunchers** (`deck.repositoryLaunchers`), and the user's global ones (`deck.terminalLaunchers`).
- **RepositoryLaunchers** reference a **Repository** by path but never register one; the **RepositoryRegistry** remains the sole source of which Repositories exist.
- Creating a **Worktree** through Deck's Add command fires every **RunOnWorktreeCreate** TerminalLauncher, each into its own headless **Terminal**.
- A **TerminalSnapshot** captures every **Terminal** on the **DeckSocket**.
- A **Terminal** may be running one **AgentSession**; the **TerminalSnapshot** captures it so the agent is resumed (not just the shell) on restore.
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
- "agent session" could mean a Deck-managed entity (with its own tree rows / chat surface) or an observed attribute of a Terminal — resolved: it is an **AgentSession**, an observed attribute. Deck never launches agents; it discovers the session via agent hooks keyed to the Terminal and resumes it by rewriting the TerminalSnapshot. (The intro's "agent chat sessions are planned" is this, not a separate chat UI.)
- "tmux session" was used for **Terminal** — resolved: the session is the backing mechanism; **Terminal** is the domain concept.
- "close" conflated closing a **Terminal**'s editor tab with destroying the **Terminal** — resolved: closing the tab is a non-destructive view operation; destroying is **TerminalRemoval** ("Delete"). Reverses ADR-0011 §6's kill-on-tab-close.
- An uncurated **WorktreeOrder** implied a curated order but had no *defined* default — git listed worktrees alphabetically by path, so a newly added Worktree surfaced mid-list, not last. Resolved: the default is **creation order** (newest last), main pinned first — mirroring the append-at-bottom invariant ADR-0028 built for TerminalOrder. See ADR-0048.
- "Project" was the canonical term for a registered repo — resolved: renamed to **Repository** for precision (it is literally a git repo, keyed by common dir). "project" is now avoided because a VS Code user reads the open *folder* as their "project," and that folder is a **Worktree** in Deck.
- "unpushed commits" was the only committed-work warning in WorktreeRemoval, but it is measured against `@{u}` and a branch with no upstream reports none — so a branch whose only ref held unique work warned nothing, and `git branch -d` refused after the fact. Resolved: branch deletion is gated by **UnmergedCommits** (vs. the default branch and remotes); "unpushed" remains a Worktree-removal signal only.
- A **Worktree** was assumed to always have a branch, so a branchless one fell back to showing its full filesystem path as the row label — resolved: a **Detached Worktree** is a real checkout and stays shown, labelled by folder name + short commit; a **Bare Worktree** has no working tree and is hidden, because Switching to one would mount git internals and poison the **ActiveWorktree**.
