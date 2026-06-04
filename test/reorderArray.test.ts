import { describe, expect, it } from 'vitest';
import { reorderArray } from '../src/tree/reorderArray';

describe('reorderArray', () => {
  it('moves an item forward below the target', () => {
    expect(reorderArray(['a', 'b', 'c', 'd'], 'b', 'd', 'below')).toEqual([
      'a',
      'c',
      'd',
      'b',
    ]);
  });

  it('moves an item backward above the target', () => {
    expect(reorderArray(['a', 'b', 'c', 'd'], 'd', 'b', 'above')).toEqual([
      'a',
      'd',
      'b',
      'c',
    ]);
  });

  it('drops above the first item', () => {
    expect(reorderArray(['a', 'b', 'c'], 'c', 'a', 'above')).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('drops below the last item', () => {
    expect(reorderArray(['a', 'b', 'c'], 'a', 'c', 'below')).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('keeps order when source equals target', () => {
    expect(reorderArray(['a', 'b', 'c'], 'b', 'b', 'above')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps order when source is missing', () => {
    expect(reorderArray(['a', 'b', 'c'], 'x', 'b', 'below')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('keeps order when target is missing', () => {
    expect(reorderArray(['a', 'b', 'c'], 'b', 'x', 'below')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('distinguishes above and below for adjacent targets', () => {
    expect(reorderArray(['a', 'b', 'c'], 'a', 'b', 'above')).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(reorderArray(['a', 'b', 'c'], 'a', 'b', 'below')).toEqual([
      'b',
      'a',
      'c',
    ]);
  });
});
