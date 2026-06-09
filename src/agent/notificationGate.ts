import type { AgentName, DetectedAgent } from './agentTypes';

export class NotificationGate {
  static shouldPrompt(input: {
    detected: readonly DetectedAgent[];
    installed: ReadonlySet<AgentName>;
    dismissed: boolean;
  }): AgentName[] {
    if (input.dismissed) return [];
    return input.detected
      .filter((agent) => !input.installed.has(agent.agent))
      .map((agent) => agent.agent);
  }
}
