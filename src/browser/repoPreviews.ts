import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePreviewDefinitions, type PreviewDefinition } from './previewDefinition';

export async function readRepoPreviews(worktreePath: string): Promise<PreviewDefinition[]> {
  try {
    const text = await readFile(join(worktreePath, '.deck', 'previews.json'), 'utf8');
    return parsePreviewDefinitions(JSON.parse(text));
  } catch {
    return [];
  }
}
