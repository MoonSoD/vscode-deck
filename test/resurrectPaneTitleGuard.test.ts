import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Guards the Deck `:` empty-guard on pane_title in the vendored tmux-resurrect
// scripts. pane_title is a Deck addition (absent upstream) that goes empty the
// moment an agent exits. Without the guard the empty field collapses under
// `read`'s whitespace IFS in dump_panes, shifting pane_current_path out of its
// column — restoring those panes at `/`. Re-vendoring from upstream, or dropping
// the guard, would silently regress this with no other signal.
const scriptsDir = join(process.cwd(), 'resources', 'plugins', 'tmux-resurrect', 'scripts');
const read = (name: string) => readFileSync(join(scriptsDir, name), 'utf8');

describe('vendored resurrect pane_title empty-guard', () => {
  it('save.sh emits pane_title with a leading `:` guard', () => {
    expect(read('save.sh')).toContain('format+=":#{pane_title}"');
    expect(read('save.sh')).not.toContain('format+="#{pane_title}"');
  });

  it('restore.sh strips the pane_title guard before use', () => {
    expect(read('restore.sh')).toContain('pane_title="$(remove_first_char "$pane_title")"');
  });
});
