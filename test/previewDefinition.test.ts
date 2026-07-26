import { describe, expect, it } from 'vitest';
import { parsePreviewDefinitions } from '../src/browser/previewDefinition';

describe('parsePreviewDefinitions', () => {
  it('parses named previews with their base port and optional fields', () => {
    expect(parsePreviewDefinitions([
      { name: 'app', portBase: 3000, portEnv: 'PORT', command: 'pnpm dev' },
      { name: 'storybook', portBase: 6006, path: '/?path=/story' },
    ])).toEqual([
      { name: 'app', portBase: 3000, portEnv: 'PORT', command: 'pnpm dev' },
      { name: 'storybook', portBase: 6006, path: '/?path=/story' },
    ]);
  });

  it('trims name, portEnv, and path', () => {
    expect(parsePreviewDefinitions([
      { name: '  app  ', portBase: 3000, portEnv: '  PORT  ', path: '  /  ' },
    ])).toEqual([{ name: 'app', portBase: 3000, portEnv: 'PORT', path: '/' }]);
  });

  it('drops entries missing a name or a positive integer portBase', () => {
    expect(parsePreviewDefinitions([
      { name: '', portBase: 3000 },
      { name: 'app', portBase: 0 },
      { name: 'app', portBase: 3000.5 },
      { name: 'ok', portBase: 4000 },
    ])).toEqual([{ name: 'ok', portBase: 4000 }]);
  });

  it('returns an empty list for non-array input', () => {
    expect(parsePreviewDefinitions(undefined)).toEqual([]);
    expect(parsePreviewDefinitions({ name: 'app', portBase: 3000 })).toEqual([]);
  });
});
