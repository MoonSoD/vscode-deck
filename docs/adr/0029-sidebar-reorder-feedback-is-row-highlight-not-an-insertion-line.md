# ADR-0029: Sidebar reorder feedback is a row highlight, not an insertion line

## Context

Dragging to reorder in Deck's sidebar highlights the whole **target row**; it
does not draw an insertion **line between rows** the way "Open Editors" and the
file Explorer do. Users can't tell from the highlight whether the dragged item
will land above or below — the complaint that prompted this work.

We researched whether the line is reachable. It is not, for a contributed view:

- The public `TreeDragAndDropController.handleDrop(target, …)` (`@types/vscode`
  1.106) receives **only the target element** — no above/below sector. There is
  no field for drop position, and none in the (now-finalized) proposed API
  either.
- VS Code *has* the affordance internally (`ListDragOverEffectPosition.Before/
  After`, `ListViewTargetSector`) but wires it only for **built-in views**.
  "Open Editors" and the Explorer are built-in; `deck.repositories` is a
  contributed `TreeView` and cannot opt in through any shippable API.
- The reorder-with-indicator request (microsoft/vscode#117505) was **closed as
  a duplicate** of the general drag-and-drop API (#32592 → PR #122239) — the
  API we already use. The indicator was never part of it.
- The only escape is replacing the `TreeView` with a `WebviewView` and
  hand-rolling list rendering + DnD DOM. That forfeits native theming, the
  `FileDecorationProvider` agent-status decorations, lazy `getChildren`, and
  expand/collapse persistence — wildly disproportionate to drawing a line.

## Decision

1. **Accept the whole-row highlight.** No insertion line; not worth a webview
   rewrite. Documented here so the research is not repeated.

2. **Placement stays direction-based and uniform.** `dropPosition` decides
   above/below from drag direction (drag down onto a row → below it; drag up →
   above it). The same rule applies to **all three** row types — Repository,
   Worktree, and now Terminal. The gesture and outcome are identical
   everywhere; consistency is the real mitigation, since the highlight can't
   convey the rule.

3. **Reorder only on a sibling target; root/empty drops are no-ops.** A row
   reorders only when dropped onto a sibling of the same kind under the same
   parent. Dropping in empty space (`target === undefined`) does nothing. This
   removes the prior Repository-only behavior of appending-to-end on an
   empty-space drop — you still reach the bottom by dragging down onto the last
   row. (External `text/uri-list` drops that *register* a Repository are a
   different payload and still append to the bottom — see the drag-to-register
   path; unaffected by this rule.)

## Status

Accepted.
