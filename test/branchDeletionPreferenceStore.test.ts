import { describe, expect, it, vi } from 'vitest';
import {
  BranchDeletionPreferenceStore,
  DELETE_BRANCH_BY_DEFAULT_KEY,
} from '../src/worktree/branchDeletionPreferenceStore';

describe('BranchDeletionPreferenceStore', () => {
  it('defaults false and round-trips the remembered preference', async () => {
    const values = new Map<string, unknown>();
    const store = new BranchDeletionPreferenceStore({
      get: vi.fn((key: string, defaultValue: boolean) =>
        values.has(key) ? (values.get(key) as boolean) : defaultValue,
      ),
      update: vi.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
    });

    expect(store.get()).toBe(false);

    await store.set(true);

    expect(values.get(DELETE_BRANCH_BY_DEFAULT_KEY)).toBe(true);
    expect(store.get()).toBe(true);
  });
});
