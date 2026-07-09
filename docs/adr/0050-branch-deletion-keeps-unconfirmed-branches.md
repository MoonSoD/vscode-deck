# ADR-0050: Branch deletion keeps unconfirmed branches — reactive `-d` gate with a guarded force toast

## Context

WorktreeRemoval's opt-in branch deletion runs `git branch -d` and, on failure,
surfaces git's raw stderr in an error toast — a dead end
(`worktreeRemovalCommand.ts:163-168`). An incident showed how this goes wrong:
a stale test branch held one commit whose only ref was the branch itself, yet
the removal modal warned nothing, because its "unpushed commits" signal is
computed as `@{u}..HEAD` and a branch with no upstream silently reports none
(`worktrees.ts:96-104`). The user opted in to deletion on bad information;
git's `-d` safety refused after the fact; Deck relayed
`error: the branch 'test-21' is not fully merged` plus git's `hint:` lines and
stopped.

The risk concept the modal *should* gate on is **UnmergedCommits** (see
CONTEXT.md): commits branch deletion would orphan — not "unpushed vs
upstream". A survey of eleven comparable tools (orca, superset, tuicommander,
agent-deck, git-worktree-manager, dmux, claude-squad, crystal, cmux, amux,
sanctel) found three viable stances:

1. **Consent means force** (superset): the opt-in checkbox is the consent, so
   always `-D`; warn upfront with non-blocking banners. Rationale in their
   source: refusing unmerged branches "would just silently drop the opt-in."
2. **Prove, then force** (orca): `-d` first; on refusal, run a merge-proof
   (merge-tree, `git cherry` patch-equivalence, squash `patch-id` matching
   against a recorded base ref / `origin/HEAD`) and auto-force only when the
   branch provably contributes nothing; otherwise keep it and toast
   "Worktree deleted, branch kept" with a guarded force action.
3. **Safe delete, dead end** (git-worktree-manager, Deck today): `-d`, raw
   error, user drops to the CLI.

Two facts constrain the design. First, this repository squash-merges: a
squash-merged branch *always* looks unmerged to any reachability check —
including `-d` itself — so "has unmerged commits" fires on a large fraction of
routine, safe removals. Second, ADR-0016 made removal optimistic: branch
deletion runs detached after the user has visually moved on, so any
after-the-fact signal must be a self-sufficient toast, not a dialog.

## Decision

1. **No upfront warning; `git branch -d` stays both gate and detector.** An
   upfront "unmerged commits" warning would fire on most squash-merged
   branches. A warning that is usually a false alarm gets click-through
   trained, and if clicking through means force-delete, the trained-to-ignore
   path *is* the data-loss path — the worst shape a confirmation UX can take.
   Reactively, the safe outcome is the default and the risky action demands
   its own deliberate click, so the routine case and the genuinely-dangerous
   case *feel different* instead of showing the same ignorable warning. The
   modal gains no git calls and no new copy.

2. **Classify the refusal; toast in Deck's words.** Only a `-d` failure whose
   stderr says "not fully merged" gets the new treatment; any other
   branch-deletion error keeps the existing generic error toast. The refusal
   raises a *warning* toast (the removal succeeded — ADR-0016 §5, the row
   stays gone):

   > Worktree removed — branch `test-21` kept: git could not confirm its
   > commits are merged.
   > `[Force Delete Branch]`

   The copy is deliberately **baseline-free** ("could not confirm"), because
   naming a baseline overclaims: `-d` checks reachability from the HEAD of the
   cwd it runs in (or the branch's upstream), not from `main`; a branch forked
   from another feature branch can refuse `-d` while its commits are safe on
   the parent. Orca ships this same wording strategy even with its full
   merge-proof, for the same reason. Raw git stderr and `hint:` lines never
   reach the user.

3. **Run the delete from the main worktree** (`mainWorktreePath ??
   repositoryPath`). `-d`'s implicit baseline is the cwd's HEAD; the discovery
   seed's checkout is arbitrary, while the main worktree's HEAD is almost
   always the default branch. One-line change; makes the gate's behavior match
   user intuition without building default-branch detection. Any cwd is
   *safe* — a `-d` refusal can only be over-cautious — this only reduces
   spurious KeptBranch toasts.

4. **Guard the force action with the branch tip recorded at refusal.** VS Code
   toasts persist in the notification center; the click can come hours later,
   after the branch gained commits from a terminal. On click, force-delete
   only if the branch still points at the recorded SHA; if it moved, replace
   the toast with a "review it before deleting" message. One `rev-parse`
   compare — orca's `expectedHead` guard, without its `update-ref` machinery.

5. **Nothing else.** No "Show Commits" action (the branch still exists —
   that is the point), no "Keep" button (dismissing the toast is keeping it),
   no persistence of KeptBranch state beyond the toast.

## Considered options

- **Upfront warning in the removal modal (superset, tuicommander), rejected.**
  Puts information at the decision point — the textbook answer — but the
  squash-merge workflow makes the warning fire on routine removals, and
  click-through training converts it into a data-loss accelerant (see
  Decision 1). It also sits awkwardly in ADR-0016's optimistic flow: the
  warning would precede a detached deletion whose outcome arrives later
  anyway.

- **Always `-D`; the opt-in is the consent (superset), rejected.** Honors the
  user's stated intent and can never "silently drop the opt-in," but the
  incident shows the opt-in is often given on incomplete information — the
  modal cannot warn reliably (no upstream ⇒ no signal), so consent is not
  informed. Deck keeps `-d` precisely because the modal's information is
  incomplete by design.

- **Orca's merge-proof before keeping (auto-force squash-merged branches),
  deferred.** Three proofs (merge-tree no-op, `git cherry` all-equivalent,
  net-diff `patch-id` matched against target commits) aimed at a recorded
  base ref, then `origin/HEAD`, then HEAD — ~200 lines plus a `fetch
  --prune`. It is a pure noise-reduction upgrade over this ADR: the toast UX
  is already complete and safe without it. Build it only if KeptBranch toasts
  on squash-merged branches prove annoying in practice. When that day comes,
  `origin/HEAD` aims the proof correctly for a merge-to-main workflow.

- **Recording `branch.<name>.base` at creation, rejected.** Orca records the
  fork point when creating a worktree and reads it as the first proof target.
  The record is creation-time-only (it cannot be backfilled honestly — a
  discovery-time `merge-base` guess would launder an inference into a fact a
  force-delete decision might trust), which argued for writing it now. But
  toast-only has no consumer, and even the deferred merge-proof is aimed well
  enough by `origin/HEAD` unless branches routinely fork from non-default
  bases — which they do not here. If the merge-proof is ever built *and*
  stacked/non-main-based branches become routine, record the base in Deck's
  Add path only (`newBranch` + `baseRef`), never on discovery.

- **Silent keep (agent-deck, tuicommander's worktree path), rejected.** Both
  tools swallow the `-d` failure and leave the branch behind with only a log
  line. The branch survives, but the user's opt-in is silently dropped and
  stale branches accumulate with no explanation. Rollback and failure must be
  communicated (same principle as ADR-0016's rejected silent reappear).

## Consequences

- The incident's failure mode is gone: no raw git stderr, no dead end. The
  same removal now ends with the worktree gone and one toast offering the
  force-delete the user would otherwise perform manually.
- Squash-merged branches *will* toast even though they are safe — the known
  cost of reachability as the detector, shared with `git branch -d` itself.
  The toast is one click to resolve. If this proves noisy, the orca-style
  merge-proof is the designated upgrade path and slots in behind the same
  toast (fewer toasts, same UX).
- "Unpushed commits" remains a Worktree-removal signal only; it still reports
  false for upstream-less branches. That is now acceptable by design: the
  committed-work risk it was mistaken for is UnmergedCommits, guarded
  reactively.
- A user who misses the toast keeps an extra branch — the failure direction
  is clutter, never data loss.
- The stderr classification ("not fully merged") is a dependency on git's
  message text. If git rewords it, the refusal degrades to the generic error
  toast — the pre-ADR behavior, not data loss.

## Refines

- ADR-0016. Branch-deletion failure keeps its own toast and never brings the
  row back (§5); this ADR upgrades that toast from a raw-stderr dead end to
  the KeptBranch surface with a guarded force action.

## Status

Accepted.
