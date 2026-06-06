export function tmuxSafe(value: string): string {
  return value.replace(/[:./]/g, '_');
}

export function terminalSessionName(worktreePath: string, n: number): string {
  return `${terminalSessionPrefix(worktreePath)}${n}`;
}

export function terminalSessionPrefix(worktreePath: string): string {
  return `${terminalWorktreePrefix(worktreePath)}term-`;
}

export function terminalWorktreePrefix(worktreePath: string): string {
  return `wt-${tmuxSafe(worktreePath)}__`;
}

export function allocateTermN(worktreePath: string, existingSessions: readonly string[]): number {
  let max = 0;
  for (const session of existingSessions) {
    const n = terminalSessionNumber(worktreePath, session);
    if (n > max) max = n;
  }
  return max + 1;
}

export function terminalSessionNumber(worktreePath: string, sessionName: string): number {
  const prefix = terminalSessionPrefix(worktreePath);
  if (!sessionName.startsWith(prefix)) return 0;
  const n = Number(sessionName.slice(prefix.length));
  return Number.isInteger(n) ? n : 0;
}
