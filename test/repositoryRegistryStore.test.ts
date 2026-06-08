import { describe, expect, it } from 'vitest';
import {
  REPOSITORY_REGISTRY_KEY,
  RepositoryRegistryStore,
} from '../src/repository/repositoryRegistryStore';

function createStore() {
  const values: Record<string, unknown> = {};
  const store = new RepositoryRegistryStore({
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  });

  return { store, values };
}

describe('RepositoryRegistryStore', () => {
  it('lists an empty registry', () => {
    const { store } = createStore();

    expect(store.list()).toEqual([]);
  });

  it('appends Repositories in insertion order and ignores duplicate appends', async () => {
    const { store, values } = createStore();

    await store.append('/repo/b');
    await store.append('/repo/a');
    await store.append('/repo/b');

    expect(values[REPOSITORY_REGISTRY_KEY]).toEqual(['/repo/b', '/repo/a']);
    expect(store.list()).toEqual(['/repo/b', '/repo/a']);
  });

  it('returns a snapshot of the registry', async () => {
    const { store } = createStore();
    await store.append('/repo/a');

    const snapshot = store.list() as string[];
    snapshot.push('/repo/b');

    expect(store.list()).toEqual(['/repo/a']);
  });

  it('contains and removes Repositories from the registry', async () => {
    const { store } = createStore();
    await store.append('/repo/a');
    await store.append('/repo/b');

    expect(store.contains('/repo/a')).toBe(true);
    expect(store.contains('/repo/c')).toBe(false);

    await store.remove('/repo/a');

    expect(store.list()).toEqual(['/repo/b']);
    expect(store.contains('/repo/a')).toBe(false);
  });
});
