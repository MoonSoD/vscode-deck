import { readRepoPreviews } from './repoPreviews';
import { parseRepositoryPreviews, selectRepositoryPreviewsFor } from './repositoryPreviews';
import { parsePreviewDefinitions, type PreviewDefinition } from './previewDefinition';
import {
  PASS_THROUGH_COMMON_DIR_CACHE,
  resolveCommonDirSafe,
} from '../repository/repositoryCommonDirCache';

interface ResolvePreviewsOptions {
  readRepo?: (worktreePath: string) => Promise<PreviewDefinition[]>;
  resolveCommonDir?: (repositoryPath: string) => Promise<string | null>;
}

// The PreviewDefinitions for a Worktree, merged from the three sources —
// committed `.deck/previews.json` first, then per-Repository settings, then
// global — and deduped by name (first source wins), since name is a
// PreviewWindow's identity and two rows with one name would collide. Mirrors
// resolveLaunchers, but returns one flat ordered list because each definition is
// a row, not a Quick Pick group.
export async function resolvePreviews(
  worktreePath: string,
  userPreviewConfig: unknown,
  repositoryPreviewConfig: unknown = [],
  options: ResolvePreviewsOptions = {},
): Promise<PreviewDefinition[]> {
  const readRepo = options.readRepo ?? readRepoPreviews;
  const resolveCommonDir = options.resolveCommonDir ?? defaultResolveCommonDir;
  const repositoryPreviews = parseRepositoryPreviews(repositoryPreviewConfig);

  const ordered = [
    ...(await readRepo(worktreePath)),
    ...(await selectRepositoryPreviewsFor(worktreePath, repositoryPreviews, resolveCommonDir)),
    ...parsePreviewDefinitions(userPreviewConfig),
  ];

  return dedupeByName(ordered);
}

function dedupeByName(previews: PreviewDefinition[]): PreviewDefinition[] {
  const seen = new Set<string>();
  const unique: PreviewDefinition[] = [];
  for (const preview of previews) {
    if (seen.has(preview.name)) continue;
    seen.add(preview.name);
    unique.push(preview);
  }
  return unique;
}

async function defaultResolveCommonDir(repositoryPath: string): Promise<string | null> {
  return resolveCommonDirSafe(PASS_THROUGH_COMMON_DIR_CACHE, repositoryPath);
}
