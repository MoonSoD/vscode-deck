import { createHash } from 'node:crypto';

interface PaneQuiescenceOptions {
  windowMs: number;
  now: () => number;
}

export class PaneQuiescence {
  private readonly captures = new Map<string, { hash: string; firstSeenAt: number }>();

  constructor(private readonly options: PaneQuiescenceOptions) {}

  accept(sessionName: string, capture: string): boolean {
    const now = this.options.now();
    const hash = hashCapture(capture);
    const previous = this.captures.get(sessionName);
    if (!previous || previous.hash !== hash) {
      this.captures.set(sessionName, { hash, firstSeenAt: now });
      return false;
    }

    return now - previous.firstSeenAt >= this.options.windowMs;
  }

  forget(sessionName: string): void {
    this.captures.delete(sessionName);
  }
}

function hashCapture(capture: string): string {
  return createHash('sha256').update(capture).digest('hex');
}
