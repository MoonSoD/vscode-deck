import { describe, expect, it } from 'vitest';
import {
  PROJECT_REGISTRY_KEY,
  ProjectRegistryStore,
} from '../src/project/projectRegistryStore';

function createStore() {
  const values: Record<string, unknown> = {};
  const store = new ProjectRegistryStore({
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  });

  return { store, values };
}

describe('ProjectRegistryStore', () => {
  it('lists an empty registry', () => {
    const { store } = createStore();

    expect(store.list()).toEqual([]);
  });

  it('appends Projects in insertion order and ignores duplicate appends', async () => {
    const { store, values } = createStore();

    await store.append('/repo/b');
    await store.append('/repo/a');
    await store.append('/repo/b');

    expect(values[PROJECT_REGISTRY_KEY]).toEqual(['/repo/b', '/repo/a']);
    expect(store.list()).toEqual(['/repo/b', '/repo/a']);
  });

  it('contains and removes Projects from the registry', async () => {
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
