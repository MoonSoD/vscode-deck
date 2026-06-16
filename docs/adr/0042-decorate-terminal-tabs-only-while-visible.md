# ADR-0042: Decorate Terminal tabs only while visible

## Context

Agent-aware tab decoration (ADR-0023, ADR-0039) writes a Terminal's
`#{window_name}`-derived icon and its TUI-title label onto the editor tab by
setting `WebviewPanel.title` / `WebviewPanel.iconPath`. `refreshIcons` /
`refreshTitles` apply these to **every** open Terminal panel whenever an
`AgentStatus` or `AgentTitle` changes.

Empirically, **writing `title` or `iconPath` to a *hidden* `WebviewPanel` makes
VS Code activate that tab.** Verified with instrumented builds: a write to a
background panel was followed every time by `onDidChangeTabs` reporting that tab
active (`panel.active` was still `false` synchronously after the write — the
activation lands on the next tick); skipping the write never activated it; and
no `reveal()`/`openWith` was involved. Neither `preserveFocus`, the webview's
`window`-focus → `terminal.focus()` listener, nor focus reconciliation explained
it — only the decoration write did.

The user-visible effect: with two Terminals open, an agent/shell update in a
**background** Terminal yanked the active editor tab to it, and the active-row
highlight (issue #71) faithfully followed — stealing the sidebar selection the
user had placed elsewhere. It surfaced during QA of the #134 fix and sits
**upstream of the #134 guard** (which correctly suppresses the *churn* but cannot
un-steal an active-tab change VS Code actually made).

VS Code exposes **no API to decorate a background editor tab without touching
it** — `WebviewPanel.iconPath` is the only lever and routes through activation
(microsoft/vscode#90616). The established lifecycle pattern is to gate webview
side-effects on visibility via `onDidChangeViewState` (VS Code Webview API
guide; cf. the focus-steal class in anthropics/claude-code#14995,
microsoft/vscode#76863).

## Decision

**Decorate a Terminal tab only while its panel is visible.** `applyTabDecoration`
no-ops when `panel.visible` is false; an `onDidChangeViewState` subscription
re-applies the current label/icon the moment the tab becomes visible. The
**sidebar row** remains the live `AgentStatus` / `AgentTitle` surface for hidden
Terminals (ADR-0025, ADR-0040, ADR-0041), and `AgentStatusNotification` still
fires — so the "which background agent needs me" signal is preserved; only the
redundant *tab* glyph lags.

This **amends ADR-0023/0039**: agent identity/status is shown on a tab only while
that tab is visible, not live on background tabs.

## Considered Options

- **Write decoration, then re-activate the previously-active tab** — rejected:
  re-activating requires `reveal()`, which steals focus and flickers, and there
  is no clean "restore prior active tab" primitive.
- **Drop tab decoration entirely** — rejected: the *visible* tab should still
  show its agent icon/label; only background writes are harmful.
- **Live with the activation** — rejected: it is the bug.

## Consequences

- A hidden Terminal's tab icon/label is **stale until the tab is shown**; it
  refreshes on `onDidChangeViewState`. Accepted because the sidebar row carries
  live status.
- **Bonus:** window restore no longer thrashes tabs — VS Code eagerly resolves
  restored background custom editors, and decorating them previously activated
  each in turn; deferring to visible removes that.
- Reaffirms the boundary that **the sidebar row, not the background editor tab,
  is Deck's live agent-status surface** — consistent with VS Code's own model
  (tree/explorer decorations signal background state, editor tabs do not).

## Status

Accepted.
