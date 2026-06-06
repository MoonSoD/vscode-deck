export function tmuxSafe(value: string): string {
  return value.replace(/[:./]/g, '_');
}

export function terminalSessionName(worktreePath: string, n: number): string {
  return `${terminalSessionPrefix(worktreePath)}${n}`;
}

export function terminalSessionPrefix(worktreePath: string): string {
  return `wt-${tmuxSafe(worktreePath)}__term-`;
}

export function allocateTermN(worktreePath: string, existingSessions: readonly string[]): number {
  const prefix = terminalSessionPrefix(worktreePath);
  let max = 0;
  for (const session of existingSessions) {
    if (!session.startsWith(prefix)) continue;
    const n = Number(session.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return max + 1;
}
