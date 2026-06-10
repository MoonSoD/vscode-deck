import type { AgentName, DetectedAgent } from './agentTypes';

export class NotificationGate {
  static shouldPrompt(input: {
    detected: readonly DetectedAgent[];
    currentInstalls: ReadonlySet<AgentName>;
    deckHookInstalls: ReadonlySet<AgentName>;
    dismissed: boolean;
  }): AgentName[] {
    return input.detected
      .filter((agent) => {
        if (input.currentInstalls.has(agent.agent)) return false;
        if (input.deckHookInstalls.has(agent.agent)) return true;
        return !input.dismissed;
      })
      .map((agent) => agent.agent);
  }
}
