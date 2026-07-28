import { promises as fs } from 'fs';
import path from 'path';
import { fillPlaceholders, LEGAL_DOCS, type LegalSlug } from './config';

/** Read a legal document's markdown from disk and substitute placeholders. */
export async function loadLegalDoc(slug: LegalSlug): Promise<string> {
  const file = path.join(process.cwd(), 'src', 'content', 'legal', `${slug}.md`);
  const raw = await fs.readFile(file, 'utf8');
  return fillPlaceholders(raw);
}

export function isLegalSlug(value: string): value is LegalSlug {
  return LEGAL_DOCS.some(d => d.slug === value);
}
