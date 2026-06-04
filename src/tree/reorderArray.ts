export type DropPosition = 'above' | 'below';

export function reorderArray<T>(
  items: readonly T[],
  source: T,
  target: T,
  position: DropPosition,
): T[] {
  if (source === target) return [...items];

  const sourceIndex = items.indexOf(source);
  const targetIndex = items.indexOf(target);
  if (sourceIndex === -1 || targetIndex === -1) return [...items];

  const next = [...items];
  next.splice(sourceIndex, 1);

  const targetIndexAfterRemoval = next.indexOf(target);
  const insertIndex =
    position === 'above' ? targetIndexAfterRemoval : targetIndexAfterRemoval + 1;
  next.splice(insertIndex, 0, source);
  return next;
}
