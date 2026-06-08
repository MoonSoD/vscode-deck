# ADR-0006: Deck lives in the secondary sidebar; registration is not switching

## Context

ADR-0003 made `vscode.openFolder` + reload the canonical switch. ADR-0004
added DetachedOpen as a no-reload escape hatch. ADR-0005 stopped Add Worktree
from auto-paying the reload cost.

Three problems remained around Deck's startup posture:

1. **Perceived reload disruption.** On every switch the workbench reload made
   Explorer briefly visible before FocusIntent redirected the user back to
   Deck's Activity Bar container. The "flash" was the most visible cost of
   switching even for users for whom the reload itself was acceptable.
2. **Add Repository still auto-reloaded.** `repositoryTree.ts:127` called
   `vscode.openFolder(seedPath, { forceNewWindow: false })` after every
   successful registration, fusing registration with switching. Adding three
   repositories from cold paid three reloads.
3. **FocusIntent was a fragile cross-window mechanism.** A flag set in
   `globalState` pre-reload and consumed inside the new window's `activate()`.
   Consumption required eager activation (`onStartupFinished`), defeating any
   plan to activate Deck only when its view becomes visible. The flag could
   also be consumed by the wrong window when multiple Deck windows existed.

Storage was the fourth misalignment: `deck.repositories` lived in the user's
`settings.json` (via `ConfigurationTarget.Global`). The rest of Deck's state
(ActiveWorktree, WorktreeOrder) lived in `globalState`. The settings location
caused Settings Sync to propagate absolute, machine-local paths and surfaced
Deck's internals as user-editable preferences.

Alternatives considered:

- **Move Deck into the Explorer container as a section.** Always-visible when
  Explorer is open. Rejected — competes with Files Explorer for vertical
  space; Deck loses an exclusive surface.
- **Keep Activity Bar; show an onboarding toast.** Doesn't address the
  reload-flash; FocusIntent and its bugs survive.
- **Move to a custom panel container.** Wrong shape — panel is for ephemeral
  output (terminal, problems), not navigation trees.

## Decision

1. **Container.** Deck contributes its `viewsContainer` to `secondarySidebar`
   (stable contribution point in VS Code; previously gated behind proposed API
   `contribSecondarySideBar`, un-gated and shipped in stable). The container
   id remains `deck`; `ctrl+alt+d`'s target (`workbench.view.extension.deck`)
   is unchanged because VS Code generates that command from the id, not the
   location.

2. **Activation.** `activationEvents` becomes `["onView:deck.repositories"]`.
   Deck activates when its view becomes visible — the moment the secondary
   sidebar is open and Deck's container is selected. `onStartupFinished` is
   removed.

3. **AddRepository decoupled.** AddRepository becomes pure registration: append to
   the new `RepositoryRegistryStore`, refresh the tree, auto-expand and
   `TreeView.reveal` the new Repository node, then show a non-modal toast
   `Added repository <basename>.` with `Switch` / `Open in New Window` actions
   (mirroring ADR-0005's post-create-worktree pattern). No auto-reload. The
   Open in New Window action is the rightmost / Enter-default, matching
   ADR-0005's posture.

4. **FocusIntent retired.** All three set-sites (SwitchOperation, AddRepository,
   DetachedOpen), the consume site in `extension.ts`, and the
   `setFocusIntent` / `consumeFocusIntent` API on `ActiveWorktreeStore` are
   removed. VS Code's per-folder workspace storage handles restoration of
   secondary-sidebar visibility for previously-opened folders; first-time
   opens fall back to a one-keystroke `Cmd+Alt+B`.

5. **Storage.** Registered repositories live in `RepositoryRegistryStore` under
   `globalState`. The old settings-backed registry and one-shot migration were
   removed when the domain term changed to Repository; there is no
   backward-compatibility bridge. Add Repository is the only entry point.

6. **First-install discovery.** A `contributes.walkthroughs` entry with a
   single step directs the user to open the secondary sidebar via a
   `command:workbench.action.toggleAuxiliaryBar` link. Once opened, Deck's
   view becomes visible, `onView` fires, `activate()` runs, and the
  `viewsWelcome` empty-state ("No repositories yet. [Add Repository]") takes over.

## Mechanics

- `engines.vscode` in `package.json` bumps to the minimum stable version
  where `secondarySidebar` is accepted as a `viewsContainers` key (verify
  exact version at implementation time; conservative floor is the milestone
  when the contribSecondarySideBar gate was removed from stable).
- RepositoryRegistryStore mirrors WorktreeOrderStore: `globalState`-backed, list
  of registered seed paths in insertion order, no Settings Sync opt-in (paths
  are machine-local).
- viewsWelcome remains static markdown — VS Code shows it whenever the
  TreeDataProvider returns an empty array. No context key wiring needed.
- Post-AddRepository reveal requires holding a `TreeView` handle in
  `extension.ts` and injecting it into `RepositoryTreeProvider`. One additional
  constructor dependency.
- The AddRepository toast reuses `WorktreeSwitcher` for Switch and
  `DetachedOpener` for Open in New Window — same call sites as the
  ADR-0005 toast, different source path (the seed path of the new Repository).

## Consequences

- Reload-flash is eliminated for users with the secondary sidebar open.
  ADR-0003's reload itself still happens on Switch; only its visible "Explorer
  flashed first" symptom is gone.
- Add Repository is no longer destructive-in-place. N repositories can be registered
  from one window with zero reloads.
- Discovery shifts from an Activity Bar icon to walkthrough + Marketplace
  listing. Power users gain an always-on surface; new users learn via the
  walkthrough that Deck lives in the secondary sidebar.
- One UX regression: the first time a user opens (via AddRepository's `Switch`,
  AddWorktree's `Switch`, or DetachedOpen) a folder Deck has never seen, the
  new window may land with secondary sidebar closed. The user presses
  `Cmd+Alt+B`. Subsequent opens of the same folder restore Deck visibility
  automatically.
- `ActiveWorktreeStore` shrinks: `setFocusIntent` / `consumeFocusIntent` are
  removed. CONTEXT.md's note about ActiveWorktree continuing to drift toward
  vestigial (from ADR-0004) holds — the store now serves only the removal-
  hygiene path and clicks on Repository nodes that re-open their last worktree.
- Marketplace installs land silently until the walkthrough is consulted or
  the secondary sidebar is opened. Accepted.

## Refines

- ADR-0004 (DetachedOpen). The FocusIntent call site is removed; DetachedOpen
  continues to use `forceNewWindow: true` without a post-reload focus
  mechanism.
- ADR-0005 (post-create switch is opt-in). The same opt-in-switch posture is
  extended to AddRepository — both create flows now end identically: refresh,
  reveal, toast, no auto-reload.

## Status

Accepted.
