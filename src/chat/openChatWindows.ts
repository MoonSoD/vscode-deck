// The Claude VS Code extension opens each session as a webview editor panel
// whose view type contains `claudeVSCodePanel` (VS Code namespaces it, e.g.
// `mainThreadWebview-claudeVSCodePanel`, so it is matched by substring — the same
// way the extension finds its own panels). A tab exposes only its label, so an
// open ChatSession can be recognised only by its title. This sees just the
// current window's tabs; sessions open in other windows are not visible here.
export const CLAUDE_PANEL_VIEW_TYPE = 'claudeVSCodePanel';

export function collectOpenChatWindowTitles(
  tabs: readonly { label: string; viewType?: string }[],
): Set<string> {
  const titles = new Set<string>();
  for (const tab of tabs) {
    if (tab.viewType?.includes(CLAUDE_PANEL_VIEW_TYPE)) titles.add(tab.label);
  }
  return titles;
}

// A ChatSession's window is recognised by its title, but VS Code truncates a long
// tab label with a trailing ellipsis ("Improve review cleanup s…"), so an exact
// compare against the full on-disk title fails. When the tab label is truncated,
// match its visible prefix against the start of the title; otherwise require an
// exact (trimmed) match, so a short label can't prefix-match many sessions.
export function chatWindowTitleMatches(tabLabel: string, sessionTitle: string): boolean {
  const label = tabLabel.trim();
  const title = sessionTitle.trim();
  if (label.length === 0 || title.length === 0) return false;
  if (label === title) return true;
  const prefix = label.replace(/(?:…|\.\.\.)$/, '').trim();
  if (prefix.length > 0 && prefix.length < label.length) return title.startsWith(prefix);
  return false;
}
