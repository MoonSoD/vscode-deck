import { describe, expect, it } from 'vitest';
import {
  PROJECT_COMMON_DIR_CACHE_KEY,
  PROJECT_COMMON_DIR_CACHE_SCHEMA_VERSION,
  ProjectCommonDirCache,
} from '../src/project/projectCommonDirCache';

function createStore() {
  const values: Record<string, unknown> = {};
  const store = new ProjectCommonDirCache({
    get: <T>(key: string, defaultValue: T) => (values[key] as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    },
  });

  return { store, values };
}

describe('ProjectCommonDirCache', () => {
  it('returns undefined for an empty cache', () => {
    const { store } = createStore();

    expect(store.get('/work/alpha-main')).toBeUndefined();
  });

  it('round-trips a common-dir for one project path', async () => {
    const { store } = createStore();

    await store.set('/work/alpha-main', '/git/alpha');

    expect(store.get('/work/alpha-main')).toBe('/git/alpha');
  });

  it('treats schema-version mismatch as cold cache', () => {
    const { store, values } = createStore();
    values[PROJECT_COMMON_DIR_CACHE_KEY] = {
      '/work/alpha-main': {
        schemaVersion: PROJECT_COMMON_DIR_CACHE_SCHEMA_VERSION - 1,
        commonDir: '/git/alpha',
      },
    };

    expect(store.get('/work/alpha-main')).toBeUndefined();
  });

  it('clears one project path without touching others', async () => {
    const { store } = createStore();
    await store.set('/work/alpha-main', '/git/alpha');
    await store.set('/work/beta-main', '/git/beta');

    await store.clear('/work/alpha-main');

    expect(store.get('/work/alpha-main')).toBeUndefined();
    expect(store.get('/work/beta-main')).toBe('/git/beta');
  });

  it('isolates multiple project paths', async () => {
    const { store } = createStore();

    await store.set('/work/alpha-main', '/git/alpha');
    await store.set('/work/beta-main', '/git/beta');

    expect(store.get('/work/alpha-main')).toBe('/git/alpha');
    expect(store.get('/work/beta-main')).toBe('/git/beta');
  });
});
