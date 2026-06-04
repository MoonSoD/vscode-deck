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
});
