// VS Code resolves Terminal.processId after the shell process starts. In
// degenerate cases (failed launch, slow startup) the Thenable may never
// resolve. Bound the wait so PID-store writes and hydration don't hang
// the activate path; a timeout is treated as "no PID available", which
// falls through to the same code path as a process whose PID we never
// captured.
export async function awaitProcessId(
  terminal: { processId?: Thenable<number | undefined> },
  timeoutMs = 2000,
): Promise<number | undefined> {
  if (!terminal.processId) return undefined;
  return await Promise.race([
    Promise.resolve(terminal.processId),
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), timeoutMs)),
  ]);
}
