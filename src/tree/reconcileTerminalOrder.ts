export function reconcileTerminalOrder<T extends { sessionName: string }>(
  storedOrder: readonly string[] | undefined,
  liveSessions: readonly T[],
): readonly T[] {
  const sortedLiveSessions = [...liveSessions].sort(
    (left, right) => terminalNumber(left.sessionName) - terminalNumber(right.sessionName),
  );
  if (storedOrder === undefined) return sortedLiveSessions;

  const bySessionName = new Map(sortedLiveSessions.map((session) => [session.sessionName, session]));
  const emitted = new Set<string>();
  const ordered: T[] = [];

  for (const sessionName of storedOrder) {
    const session = bySessionName.get(sessionName);
    if (!session) continue;
    ordered.push(session);
    emitted.add(sessionName);
  }

  for (const session of sortedLiveSessions) {
    if (!emitted.has(session.sessionName)) ordered.push(session);
  }

  return ordered;
}

function terminalNumber(sessionName: string): number {
  return Number(sessionName.match(/__term-(\d+)$/)?.[1] ?? Number.MAX_SAFE_INTEGER);
}
