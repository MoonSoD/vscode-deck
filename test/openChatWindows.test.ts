import { describe, expect, it } from 'vitest';
import { chatWindowTitleMatches, collectOpenChatWindowTitles } from '../src/chat/openChatWindows';

describe('collectOpenChatWindowTitles', () => {
  it('collects labels of Claude webview panels, matching the namespaced view type', () => {
    const titles = collectOpenChatWindowTitles([
      { label: 'Debug tests', viewType: 'mainThreadWebview-claudeVSCodePanel' },
      { label: 'notes.md' },
      { label: 'Some other webview', viewType: 'mainThreadWebview-other' },
    ]);

    expect([...titles]).toEqual(['Debug tests']);
  });

  it('returns an empty set when no Claude panels are open', () => {
    expect(collectOpenChatWindowTitles([{ label: 'file.ts' }]).size).toBe(0);
  });
});

describe('chatWindowTitleMatches', () => {
  it('matches an exact title', () => {
    expect(chatWindowTitleMatches('Debug failing tests', 'Debug failing tests')).toBe(true);
  });

  it('matches an ellipsis-truncated tab label against the full title', () => {
    expect(
      chatWindowTitleMatches('Improve review cleanup s…', 'Improve review cleanup spec for comments'),
    ).toBe(true);
  });

  it('matches a three-dot truncation too', () => {
    expect(chatWindowTitleMatches('Improve review cleanup s...', 'Improve review cleanup spec')).toBe(true);
  });

  it('does not prefix-match a non-truncated (short) label against a longer title', () => {
    expect(chatWindowTitleMatches('Improve', 'Improve review cleanup spec')).toBe(false);
  });

  it('does not match different titles', () => {
    expect(chatWindowTitleMatches('Fix bug…', 'Add feature elsewhere')).toBe(false);
  });
});
