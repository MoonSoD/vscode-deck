import { describe, expect, it } from 'vitest';
import { projectsMigration } from '../src/project/projectsMigration';

describe('projectsMigration', () => {
  it('does nothing when settings and globalState are empty', () => {
    expect(projectsMigration([], [])).toEqual({
      merged: [],
      clearSettings: false,
    });
  });

  it('migrates settings-only Projects and clears settings', () => {
    expect(projectsMigration(['/repo/a', '/repo/b'], [])).toEqual({
      merged: ['/repo/a', '/repo/b'],
      clearSettings: true,
    });
  });

  it('leaves globalState-only Projects untouched', () => {
    expect(projectsMigration([], ['/repo/a'])).toEqual({
      merged: ['/repo/a'],
      clearSettings: false,
    });
  });

  it('appends settings Projects to globalState, dedupes, and clears settings', () => {
    expect(projectsMigration(['/repo/b', '/repo/c'], ['/repo/a', '/repo/b'])).toEqual({
      merged: ['/repo/a', '/repo/b', '/repo/c'],
      clearSettings: true,
    });
  });
});
