export type AgentName = 'claude' | 'codex';

export interface DetectedAgent {
  agent: AgentName;
  configPath: string;
}
