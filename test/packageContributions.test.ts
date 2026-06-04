import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));

describe('package contributions', () => {
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

  it('contributes delete worktree only for removable worktree rows', () => {
    expect(pkg.contributes.commands).toContainEqual({
      command: 'deck.removeWorktree',
      title: 'Deck: Delete Worktree…',
      icon: '$(trash)',
    });

    expect(pkg.contributes.menus['view/item/context']).toContainEqual({
      command: 'deck.removeWorktree',
      when: 'view == deck.projects && viewItem == deck.worktree',
      group: 'inline',
    });
    expect(pkg.contributes.menus['view/item/context']).toContainEqual({
      command: 'deck.removeWorktree',
      when: 'view == deck.projects && viewItem == deck.worktree',
      group: 'navigation',
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
});
