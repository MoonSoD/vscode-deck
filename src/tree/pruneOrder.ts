export function pruneOrder(
  storedOrder: readonly string[],
  liveKeys: ReadonlySet<string>,
): { order: readonly string[]; changed: boolean } {
  const order = storedOrder.filter((key) => liveKeys.has(key));
  const changed = order.length !== storedOrder.length;
  return { order: changed ? order : storedOrder, changed };
}
