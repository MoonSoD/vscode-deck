# ADR-0015: Terminal tab URIs are file-paths — `deck-terminal:/<worktree>/term-N`

## Context

ADR-0011 §2 gave each Deck terminal tab a URI of the shape

```
deck-terminal://<workspace-id>/<sessionName>?cwd=<encodeURIComponent(worktreePath)>
```

The shipped code never matched that spec: `SessionUriCodec` hardcodes the
authority to the literal string `session`, nothing reads it, and `CONTEXT.md`
documents yet a third variant. The scheme was assembled without a clear model
of what each URI component is *for* — the divergence between ADR, doc, and code
is the evidence.

Three structural problems followed from that:

1. **Identity is smeared across path + query.** `sessionName` =
   `wt-<tmuxSafe(worktreePath)>__term-N`, and `tmuxSafe` is lossy
   (`[:./]→_`), so the worktree path cannot be recovered from the URI path.
   The real path is therefore carried *again*, losslessly, in a `cwd` query —
   two representations of one fact (ADR-0011 §2 justifies the duplication by
   exactly this lossiness).

2. **The authority is dead weight.** Custom-editor routing matches against
   `${scheme}:${resource.path}` — the authority is never in the matched
   string (see Validation). `authority='session'` routes nothing and means
   nothing.

3. **Restored-but-unfocused tabs show the wrong label.** VS Code labels a
   restored custom-editor tab from its URI until the tab is focused and
   `resolveCustomEditor` runs (which sets `panel.title` to the live tmux
   window name, e.g. `zsh`/`claude`). The pre-resolve label is the URI path's
   **basename** — which, with a single-segment path of `/<sessionName>`, was
   the long `wt-…__term-N` string. An uncommitted experiment tried to fix this
   with a `resourceLabelFormatters` contribution plus a JSON-object URI query
   (`${query.name}` only resolves when the query parses as JSON — a VS Code
   `labelService` quirk), rendering a stable `term-N` proxy on restore.

The experiment works but layers a presentation concern (a `name` field, a
formatter contribution, a non-standard JSON query) onto the identity URI to
paper over a self-inflicted problem: the basename was unhelpful only because
the path was the mangled session name.

## Decision

1. **The resource is a terminal inside a folder, addressed like a file.** A
   Deck terminal is a persistent shell living *inside* a worktree — modeled
   as a file inside that folder. The URI is therefore a plain file-path:

   ```
   deck-terminal:/<worktree-path>/term-N
   ```

   e.g. `deck-terminal:/Users/almeynman/code/vscode-deck/term-1`. **No
   authority, no query.**

2. **Everything derives from the path.** The URI carries identity only:
   - `basename(path)` = `term-N` → the tab label, via VS Code's *default*
     basename labeling. No `resourceLabelFormatters`, no JSON query.
   - `dirname(path)` = the worktree path, lossless → both the `cwd` for
     `new-session -A -c <cwd>` and the worktree half of identity.
   - `sessionName = wt-<tmuxSafe(dirname(path))>__<basename(path)>`.

3. **`sessionName` is byte-identical to the pre-existing scheme.** The
   derivation reproduces ADR-0008 §2's name exactly, so live tmux sessions
   reattach across the upgrade with **no tmux-side migration** — only the URI
   string persisted in restored tabs changes.

4. **The restore label is `term-N`, for free.** This resolves the
   handover's open product decision as **option A** (stable `term-N` on
   restore, upgrading to the live command on focus) — but delivered by the
   default basename rather than a formatter. The `resourceLabelFormatters`
   contribution, the JSON-query codec, and the tolerant `parseCwd` of the
   uncommitted experiment are all deleted.

5. **No legacy decode — clean break.** The new decoder understands only the
   new scheme. On the first reload after upgrade, tabs minted by the old
   scheme fail to resolve and sit dead until the user closes them; the
   underlying tmux session is untouched, so clicking the sidebar row reopens
   it under a new-scheme URI. This follows the precedent ADR-0011 §11 set for
   the pre-cutover→custom-editor migration.

6. **`SessionUriCodec` takes/returns identity, derives the rest.** `encode`
   accepts `(worktreePath, term)`; `decode` returns the same and exposes
   `sessionName` + `cwd` as derivations. Consumers that only need
   `sessionName`/`cwd` (the transport, `findTerminalTabColumn`, the cascade,
   kill) are unaffected in intent.

## Considered Options

- **X — worktree is the resource.** `path = /<worktree-path>`, `term` in the
  query. The path basename is then the worktree name (`repo`), so a
  `resourceLabelFormatter` (`label: "term-${query.term}"`) *and* a JSON query
  are required to render `term-N`. Rejected: keeps the JSON-query quirk and a
  package.json contribution alive to solve a problem Z doesn't have.

- **Y — terminal is the resource, worktree in the query.** `path = /term-N`
  (basename label works for free), worktree path in a URL-encoded query.
  Rejected: still needs a query to carry the worktree; Z folds that worktree
  into the path's parent directory at no cost and is more faithful to the
  "file inside a folder" model.

- **B — eager-resolve for live names on restore.** Keep the URI pure identity
  and, on activation, reveal every Deck terminal tab so it resolves
  immediately → the live command name everywhere, matching the sidebar.
  Rejected: reattaches *every* terminal at startup, must restore the
  originally-active tab, and fights ADR-0013's lazy native restore — a large
  cost to avoid a brief, self-correcting `term-N` label.

- **The uncommitted `resourceLabelFormatters` + JSON-query experiment.**
  Abandoned: Z makes the path basename *be* `term-N`, so the default label is
  correct and the entire mechanism is unnecessary.

## Consequences

- Net deletion: the `resourceLabelFormatters` contribution, the JSON-query
  encode/decode, the tolerant `parseCwd`, and the `cwd` query all go. The
  duplicated worktree-path representation collapses to one (the path's
  parent).
- ADR-0011 §2's stated reason for a separate `cwd` query (lossy `sessionName`)
  is structurally resolved — `dirname(path)` is the lossless worktree path,
  available for `new-session -c` even when the session was killed externally.
- The `package.json` selector `"deck-terminal://**"` keeps routing correctly:
  the matcher targets `${scheme}:${path}` (authority-blind), and `**` spans
  the multi-segment path. Optional cosmetic tidy to `"deck-terminal:/**"`;
  both match.
- The single-slash serialization (`deck-terminal:/…`, not `://`) is not a
  style choice — `vscode.Uri` emits `//` only for an authority or the `file`
  scheme, so a no-authority `deck-terminal` URI serializes with one slash by
  construction.
- Clean break: old restored tabs are dead on the upgrade reload until closed;
  recovery is one click on the sidebar row. Cosmetic, self-correcting.
- The handover's hard constraint is unchanged: the *live* command name still
  cannot appear on a not-yet-resolved tab (it is volatile and must not be in
  the stable URI). Restore shows `term-N`; focus upgrades it to the live name.
- Implemented alongside updates to ADR-0011 §2 and the `CONTEXT.md` Terminal
  entry so the docs, glossary, and code describe the same URI shape.

## Refines

- **ADR-0011.** Supersedes the URI definition in §2 and the "identity is the
  URI" detail of §13: identity is now the file-path `(worktree, term)`, not an
  encoded `sessionName` plus a `cwd` query. The custom-editor surface,
  kill-on-dispose, cascade, and cross-worktree click flow carry forward
  unchanged. The §8 `TabSnapshotStore` was already deleted by ADR-0013.
- **ADR-0013.** Reload/switch restore via URI re-resolution is untouched; only
  the *shape* of the re-resolved URI changes. VS Code still persists and
  replays `(uri, viewType)` per folder.
- **ADR-0008.** The Terminal model and the `wt-<sanitized>__term-N` naming are
  unchanged — the new URI *derives* that same name.

## Validation

VS Code internals verified against source this cycle:

- **Routing is authority-blind.** `globMatchesResource`
  (`editorResolverService.ts`): when the glob contains a path separator the
  match target is `` `${resource.scheme}:${resource.path}` `` — the authority
  is never included. Confirms `authority='session'` routed nothing, and that
  the existing selector matches the new path.
- **One slash is correct.** `_asFormatted` (`base/common/uri.ts`) emits `//`
  only when `authority || scheme === 'file'`. A no-authority non-`file` URI is
  serialized as `scheme:/path`. Per RFC 3986, `//` is the authority delimiter,
  not a generic separator.
- **Default tab label = path basename.** Confirmed empirically by the prior
  surface: a single-segment path `/<sessionName>` rendered the long
  `wt-…__term-N` name on restored-unfocused tabs. With a `/…/term-N` path the
  basename is `term-N`.

Implementation gate: an F5 run confirming a freshly opened terminal restores
(after `Reload Window`) with a `term-N` label on the unfocused tab and the
live command name once focused — with no `resourceLabelFormatters` contribution
present.

## Status

Accepted. Implemented by issue #64.
