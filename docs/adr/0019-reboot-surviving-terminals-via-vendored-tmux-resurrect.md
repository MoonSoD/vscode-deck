# ADR-0019: Reboot-surviving Terminals via vendored tmux-resurrect

## Context

Deck's Terminals survive tab-close (ADR-0017), Switch (`destroy-unattached
off`), and window reload (reattach + capture-pane seed, ADR-0012 §5). They do
**not** survive death of the `-L deck` tmux server — a machine reboot, a crash,
or `kill-server` takes every Terminal with it, because a session is process
state on that server. Closing that last gap is the goal: after a reboot, the
user's Terminals come back with their working directory and scrollback intact.

`tmux-resurrect` + `tmux-continuum` are the established fix for "tmux sessions
survive a restart." But two of their assumptions break against Deck's design,
and we verified both against the plugin source and a working reference
(`~/code/sanctel`, which solved this exact problem):

- **continuum cannot autosave on Deck.** Its only save trigger prepends
  `#(continuum_save.sh)` to `status-right` (`continuum.tmux`,
  `add_resurrect_save_interpolation`); it fires when tmux renders the status
  bar. `deck.conf` sets `status off`, so it never fires. It is *also* gated on
  being the only running tmux server (`another_tmux_server_running`), which any
  tmux user trips. Sanctel's spike reached the same conclusion independently.
- **tpm's install path is `prefix + I`.** `deck.conf` unbinds the prefix
  entirely, so the plugin manager's install/update flow cannot run here.

## Decision

1. **Scope: reboot survival of shells only — cwd + scrollback, no relaunched
   programs.** `@resurrect-processes 'false'`. *(Superseded by ADR-0021: this is
   now `:all:`, with the agent snapshot rewriter clamping non-agent panes back to
   shells, so this "shells only" scope still holds for everything except resumed
   AgentSessions.)* A restored pane gets its prior
   scrollback and working directory, then a fresh shell prompt. Restoring
   running programs (resurrect re-executes them) is a riskier, different
   feature and is out of scope; it does not match the Terminal model ("a
   persistent shell").

2. **Vendor `tmux-resurrect`; no tpm, no continuum.** The plugin ships under
   `resources/plugins/tmux-resurrect/` and loads via `run-shell` from the conf.
   tpm is dropped (no prefix to drive it; it would add a runtime GitHub
   dependency, against the hermetic-`deck.conf` ethos of ADR-0008). continuum
   is dropped (its autosave is dead here, per Context).

3. **Deck drives save and restore directly.** Deck calls resurrect's
   `scripts/save.sh` and `scripts/restore.sh` via `tmux -L deck run-shell`,
   always with the freshly-resolved current script path — never via tmux's
   stored `@resurrect-*-script-path` options (nothing else triggers them; Deck
   has no key bindings).

4. **Restore is eager, on activation, via an anchor.** `restore.sh` needs a
   live server to run in (and to read `@resurrect-dir`). After a reboot the
   server is dead, so on activation Deck:

   ```
   if  -L deck server is NOT running  AND  deck.tmuxAvailable:
       tmux -L deck new-session -d -s __deck_anchor   # bring the server up
       tmux -L deck run-shell <vendored>/scripts/restore.sh
       tmux -L deck kill-session -t __deck_anchor
   ```

   The restored `wt-…__term-N` sessions then list live (ADR-0014) and reattach
   on click as today. This **supersedes ADR-0008 §5's "Deck is silent until
   used"**: the server now starts at activation, not on the first `+`. (The
   `existsSync(saveFile)` gate sanctel uses only for its return value was
   considered and dropped — an empty/absent snapshot makes `restore.sh` a
   no-op, and with `exit-empty on` the anchorless server self-exits, so "always
   restore" converges to the same end-state.)

5. **Save is a 5-min timer per window, plus a best-effort `deactivate()`
   save.** Every VS Code window runs its own timer; concurrent saves are
   idempotent full-server snapshots (resurrect writes a timestamped file then
   repoints `last`), so no leader election is needed. `deactivate()` fires one
   last save on clean window close but is not relied upon — VS Code may cut it
   short, and a crash never calls it. Worst case: ≤5 min of scrollback lost on
   a hard crash. No per-create/kill saves; no manual save button (descoped).

6. **The conf becomes generated; both it and the snapshot live in one
   machine-global Deck dir — not `globalStorage`.** `resources/deck.conf`
   becomes a template with `__DECK_RESURRECT_PLUGIN__` / `__DECK_RESURRECT_DIR__`
   placeholders; Deck substitutes the resolved paths and writes the result to
   **`${XDG_DATA_HOME:-~/.local/share}/deck/deck.conf`**, with the snapshot dir
   alongside at **`…/deck/resurrect`**. Deck spawns `tmux -L deck -f <that conf>`.

   `globalStorage` is rejected for **two** reasons:
   - **Spaces.** `tmux-resurrect`'s `restore.sh` silently restores nothing when
     `@resurrect-dir` contains a space (verified — see Validation), and macOS's
     `globalStorageUri` is always under `~/Library/Application Support/…`.
   - **Wrong scope.** The DeckSocket (`-L deck`) is **one tmux server per user**
     (`/tmp/tmux-$UID/deck`), shared across every VS Code instance — but
     `globalStorage` is **per-install** (Stable and Insiders have separate
     dirs). Per-install storage for a machine-global server means two installs
     would generate competing confs/snapshots for the one socket. A
     machine-global dir matches the machine-global socket.

   The dir is `deck`-namespaced, so it stays isolated from the user's own
   resurrect (`…/tmux/resurrect`). The generated conf is rewritten every
   activation, so it needs no managed persistence. `XDG_DATA_HOME` is honored
   for convention (the one knob that could reintroduce a space if a user sets it
   to a spaced path; documented). Under Remote-WSL/SSH the extension host,
   `homedir()`, and tmux all resolve in the same environment, so the dir is a
   clean Linux path there.

   > **Supersedes this ADR's own earlier decision** to keep storage under
   > `<globalStorageUri>/`. That was evidence-backed (globalStorage is VS Code's
   > recommended store) but wrong here on both counts above. The only trade lost
   > is uninstall auto-cleanup of a regenerable dir — accepted.

7. **New conf lines** (added to the ADR-0008 §11 set, unchanged otherwise):

   ```
   set -g @resurrect-dir '__DECK_RESURRECT_DIR__'
   set -g @resurrect-capture-pane-contents 'on'
   set -g @resurrect-processes 'false'
   run-shell '__DECK_RESURRECT_PLUGIN__'
   ```

8. **Persistence fails soft; it gates on the existing preflight.** A missing
   plugin script or absent bash makes `run-shell` fail — tmux logs it and the
   server still starts; Terminals work without reboot-survival. Restore gates
   on `deck.tmuxAvailable` (ADR-0008 §12). resurrect needs tmux ≥1.9, below
   Deck's existing ≥3.1 floor — no version bump. bash (resurrect's script
   interpreter) is not preflighted: WSL and every tmux-capable platform ship
   it, and the rare bash-less environment is already tmux-less and handled by
   fail-soft.

## Considered Options

- **Keep continuum for autosave** — dead here (`status off` + multi-server
  guard); rejected (see Context).
- **tpm + `@plugin` declarations** — install is `prefix + I`, and the prefix is
  unbound; rejected for vendoring + `run-shell`.
- **Gate restore on `existsSync(saveFile)`** — preserves §5 laziness for
  never-terminal users at the cost of one `fs.existsSync`. Dropped in favor of
  sanctel-exact "always restore"; §5 is no longer treated as a live invariant.
- **Snapshot dir at `~/.local/share/deck/resurrect`** — a user-facing location
  for what is regenerable internal state; forfeits VS Code's storage
  guarantees. Rejected for `globalStorage`.

## Consequences

- **No double-paint with ADR-0012 §5.** resurrect restores contents by
  recreating the pane with `cat <file>; exec <shell>` (`restore.sh`), i.e. text
  replayed into the *tmux* buffer while no control client is attached. Deck's
  reattach seed later reads that buffer once into xterm. The flow is
  `file → tmux → xterm`, sequential, not two sources on one screen.
- **Inherits the existing cursor seam.** Content restore is text replay, which
  does not carry cursor position — the same rare, self-correcting artifact
  ADR-0012 §5 already documents and accepts (and which it attributes to this
  very tool). No new defect.
- **`__deck_anchor` never shows as a row** — it does not match the
  `wt-…__term-N` prefix Deck filters on.
- **A since-removed worktree restores as an orphan session with no tree row** —
  the session is recreated on the server but its worktree is gone from
  `git worktree list`, so nothing hangs it. Identical to ADR-0008's documented
  "GC is best-effort" case; harmless.
- **New runtime dependency: bash** (resurrect's scripts). Universal on
  macOS/Linux/WSL; fails soft where absent.
- **Snapshot disk use** grows with pane count × scrollback depth; resurrect
  prunes snapshots older than 30 days (keeping ≥5).
- **Restore is gated, not just run at activation.** Because a terminal tab
  reattach issues `new-session -A` (create-or-attach), it can resurrect a
  session blank ahead of restore — on reopen *and* if the DeckSocket dies while
  VS Code stays open. So reattach (and `+`-create) await a restore gate
  (`restoreGate.ts`): if the server is dead, restore runs first; concurrent
  reattaches share one restore. This is what makes restore robust against the
  active tab (resolved eagerly on reopen) and against a live crash, not just a
  clean reboot.

## Known limitation: a tab closes when the DeckSocket dies *while VS Code is open*

If the server dies with the window open (a real tmux crash, or a manual
`tmux -L deck kill-server`), the open tab's control client exits, the webview
shows `[process exited]` and asks to dispose, and the **focused tab closes**
(ADR-0017 §3's shell-`exit`-dismisses-the-tab path, which also fires here). The
**session and scrollback are not lost** — the restore gate brings them back, the
sidebar row reappears, and reopening is one click; only the *tab* closes.

A seamless in-place reconnect was considered and rejected as not correctly
achievable: a control client emits an identical bare `%exit` for a shell `exit`
and a `kill-server` (verified), and `isServerRunning` afterward is ambiguous for
the last/only terminal (its shell-`exit` also stops the server). So any
"reconnect on death" heuristic would misclassify intentionally exiting the last
terminal as a crash and resurrect it — worse than the close-and-reopen. This
path is rare in practice: a real reboot closes VS Code, so there is no live
client to exit and tabs restore cleanly (the common case). Revisit only if
crashes-with-window-open prove common; the least-bad approach there is
correlating near-simultaneous exits across tabs, and it is still imperfect.

## Refines

- **ADR-0008.** Supersedes §5 ("silent until used") — the server now starts at
  activation when a snapshot can be restored. Extends §11's `deck.conf` with
  the resurrect lines and makes the conf a generated artifact. §10 lifecycle
  unchanged. The "GC is best-effort" consequence now also covers orphan
  restored sessions.
- **ADR-0012.** §5's capture-pane seed is unchanged; this ADR establishes that
  resurrect's content restore composes with it without duplication.
- **ADR-0014.** Reinforced, not reversed: the resurrect snapshot is tmux's own
  restore mechanism, replayed *into* tmux before Deck lists — not a second
  source of truth. Deck still resolves rows from live `list-sessions`.
- **ADR-0017.** Extends the persistence story from tab-close/Switch/reload to
  reboot/server-death.

## Validation

- continuum autosave dead under `status off`: `continuum.tmux`
  `add_resurrect_save_interpolation` writes to `status-right`; the multi-server
  guard is `main()`'s `if ! another_tmux_server_running`.
- resurrect scripts callable via `run-shell` with no prefix; "shells only" is
  `@resurrect-processes 'false'` (`docs/restoring_programs.md`); content restore
  is `cat …; exec <default-command>` (`restore.sh`).
- Anchor → restore → kill-anchor pattern and 5-min/exit save cadence:
  `~/code/sanctel` `src-tauri/src/restore_runtime.rs` (`ANCHOR_SESSION`,
  `restore_on_launch`, `start_periodic_save(300)`, `save_on_exit`).
- **Space-in-`@resurrect-dir` breaks restore (QA, macOS).** With
  `@resurrect-dir` under `~/Library/Application Support/…`, `save.sh` wrote a
  snapshot but `restore.sh` (exit 0) restored **zero** sessions; the same
  snapshot copied to a space-free dir restored the session *and* its scrollback.
  `resurrect_dir()` (`helpers.sh`) echoes the option verbatim, so the breakage
  is downstream unquoted use. Fix: §6's space-free XDG snapshot dir.
- Open verification item: stress-test a save fired mid-flood (the F6
  `seq 1 1000` style) confirms no output/keystroke loss while `save.sh` runs.

## Status

Accepted.
