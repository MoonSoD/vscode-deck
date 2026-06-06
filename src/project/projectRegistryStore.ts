import type { MementoLike } from '../switch/activeWorktreeStore';

export const PROJECT_REGISTRY_KEY = 'deck.projectRegistry';

export class ProjectRegistryStore {
  constructor(private readonly memento: MementoLike) {}

  list(): string[] {
    return this.memento.get<string[]>(PROJECT_REGISTRY_KEY, []);
  }

  contains(projectPath: string): boolean {
    return this.list().includes(projectPath);
  }

  async append(projectPath: string): Promise<void> {
    if (this.contains(projectPath)) return;
    await this.replace([...this.list(), projectPath]);
  }

  async remove(projectPath: string): Promise<void> {
    await this.replace(this.list().filter((registered) => registered !== projectPath));
  }

  async replace(projectPaths: readonly string[]): Promise<void> {
    await this.memento.update(PROJECT_REGISTRY_KEY, [...new Set(projectPaths)]);
  }
}
