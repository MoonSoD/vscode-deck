import type { MementoLike } from '../switch/activeWorktreeStore';

export const REPOSITORY_REGISTRY_KEY = 'deck.repositoryRegistry';

export class RepositoryRegistryStore {
  constructor(private readonly memento: MementoLike) {}

  list(): readonly string[] {
    return [...this.memento.get<string[]>(REPOSITORY_REGISTRY_KEY, [])];
  }

  contains(repositoryPath: string): boolean {
    return this.list().includes(repositoryPath);
  }

  async append(repositoryPath: string): Promise<void> {
    const repositoryPaths = this.list();
    if (repositoryPaths.includes(repositoryPath)) return;
    await this.replace([...repositoryPaths, repositoryPath]);
  }

  async remove(repositoryPath: string): Promise<void> {
    await this.replace(this.list().filter((registered) => registered !== repositoryPath));
  }

  async replace(repositoryPaths: readonly string[]): Promise<void> {
    await this.memento.update(REPOSITORY_REGISTRY_KEY, [...new Set(repositoryPaths)]);
  }
}
