import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

describe('package contributions', () => {
  it('contributes Deck to the secondary sidebar with first-install walkthrough', () => {
    expect(pkg.activationEvents).toEqual(['onView:deck.projects']);
    expect(pkg.engines.vscode).toBe('^1.106.0');
    expect(pkg.contributes.viewsContainers.activitybar).toBeUndefined();
    expect(pkg.contributes.viewsContainers.secondarySidebar).toEqual([{
      id: 'deck',
      title: 'Deck',
      icon: '$(repo)',
    }]);
    expect(pkg.contributes.keybindings).toContainEqual({
      command: 'workbench.view.extension.deck',
      key: 'ctrl+alt+d',
    });

    expect(pkg.contributes.walkthroughs).toEqual([{
      id: 'deck.getStarted',
      title: 'Deck',
      description: 'Open Deck from the secondary sidebar.',
      steps: [{
        id: 'deck.secondarySidebar',
        title: 'Deck lives in the secondary sidebar.',
        description: 'Open the secondary sidebar, then select Deck.',
        media: { markdown: 'media/walkthroughs/secondary-sidebar.md' },
        completionEvents: ['onCommand:workbench.action.toggleAuxiliaryBar'],
      }],
    }]);

    const markdownPath = join(process.cwd(), 'media/walkthroughs/secondary-sidebar.md');
    expect(existsSync(markdownPath)).toBe(true);
    const markdown = readFileSync(markdownPath, 'utf8');
    expect(markdown).toContain('secondary sidebar');
    expect(markdown).toContain('command:workbench.action.toggleAuxiliaryBar');
  });

  it('does not expose ProjectRegistry as a user setting', () => {
    expect(pkg.contributes.configuration?.properties?.['deck.projects']).toBeUndefined();
  });

  it('does not ship node-pty or its postinstall workaround', () => {
    expect(pkg.dependencies?.['node-pty']).toBeUndefined();
    expect(pkg.scripts?.postinstall).toBeUndefined();
  });

  it('contributes Deck Terminal as a custom editor for deck-terminal URIs', () => {
    expect(pkg.contributes.customEditors).toContainEqual({
      viewType: 'deck.terminal',
      displayName: 'Deck Terminal',
      selector: [{ filenamePattern: 'deck-terminal://**' }],
      priority: 'default',
    });
  });

  it('contributes Deck Terminal find command and keybindings', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.terminal.find',
      title: 'Deck Terminal: Find',
    });
    expect(pkg.contributes.keybindings).toContainEqual({
      command: 'deck.terminal.find',
      key: 'ctrl+f',
      mac: 'cmd+f',
      when: "activeCustomEditorId == 'deck.terminal'",
    });
  });

  it('contributes add worktree as a project-only inline tree action', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.addWorktree',
      title: 'Deck: Add Worktree',
      icon: '$(add)',
    });

    expect(pkg.contributes.menus['view/item/context']).toContainEqual({
      command: 'deck.addWorktree',
      when: 'view == deck.projects && viewItem == deck.project',
      group: 'inline',
    });
  });

  it('contributes delete worktree only via the right-click context menu', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.removeWorktree',
      title: 'Deck: Delete Worktree…',
      icon: '$(trash)',
    });

    // Worktree row's inline slot is reserved for the Add Terminal `+` icon;
    // delete-worktree lives only in the right-click context menu.
    expect(
      pkg.contributes.menus['view/item/context'].filter(
        (item: { command: string }) => item.command === 'deck.removeWorktree',
      ),
    ).toEqual([{
      command: 'deck.removeWorktree',
      when: 'view == deck.projects && viewItem == deck.worktree',
      group: 'navigation',
    }]);
  });

  it('contributes add terminal as the inline `+` action on Worktree rows', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.addTerminal',
      title: 'Deck: Add Terminal',
      icon: '$(add)',
    });

    expect(
      pkg.contributes.menus['view/item/context'].filter(
        (item: { command: string }) => item.command === 'deck.addTerminal',
      ),
    ).toEqual([{
      command: 'deck.addTerminal',
      when:
        'view == deck.projects && (viewItem == deck.worktree || viewItem == deck.worktree.active || viewItem == deck.worktree.main) && deck.tmuxAvailable',
      group: 'inline',
    }]);
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.addTerminal',
      when: 'false',
    });
  });

  it('contributes remove project only as a Project context action', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.removeProject',
      title: 'Deck: Remove from Deck…',
    });

    expect(pkg.contributes.menus['view/item/context']).toContainEqual({
      command: 'deck.removeProject',
      when: 'view == deck.projects && viewItem == deck.project',
      group: 'navigation',
    });
  });

  it('contributes open Worktree in new window as a Worktree context-only action', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.openWorktreeInNewWindow',
      title: 'Deck: Open Worktree in New Window',
    });

    expect(
      pkg.contributes.menus['view/item/context'].filter(
        (item: { command: string }) => item.command === 'deck.openWorktreeInNewWindow',
      ),
    ).toEqual([{
      command: 'deck.openWorktreeInNewWindow',
      when: 'view == deck.projects && (viewItem == deck.worktree || viewItem == deck.worktree.main)',
      group: 'navigation',
    }]);
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.openWorktreeInNewWindow',
      when: 'false',
    });
    expect(
      pkg.contributes.keybindings.some(
        (item: { command: string }) => item.command === 'deck.openWorktreeInNewWindow',
      ),
    ).toBe(false);
  });

  it('contributes close Terminal as the inline X action on Terminal rows', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.killTerminal',
      title: 'Deck: Close Terminal',
      icon: '$(close)',
    });

    expect(
      pkg.contributes.menus['view/item/context'].filter(
        (item: { command: string }) => item.command === 'deck.killTerminal',
      ),
    ).toEqual([{
      command: 'deck.killTerminal',
      when: 'view == deck.projects && (viewItem == deck.terminal.active || viewItem == deck.terminal.foreign) && deck.tmuxAvailable',
      group: 'inline',
    }]);
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.killTerminal',
      when: 'false',
    });
  });

  it('contributes open Terminal in new window as a Terminal context-only action', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.openTerminalInNewWindow',
      title: 'Deck: Open Terminal in New Window',
    });

    expect(
      pkg.contributes.menus['view/item/context'].filter(
        (item: { command: string }) => item.command === 'deck.openTerminalInNewWindow',
      ),
    ).toEqual([{
      command: 'deck.openTerminalInNewWindow',
      when: 'view == deck.projects && viewItem == deck.terminal.foreign && deck.tmuxAvailable',
      group: 'navigation',
    }]);
    expect(pkg.contributes.menus.commandPalette).toContainEqual({
      command: 'deck.openTerminalInNewWindow',
      when: 'false',
    });
  });
});
