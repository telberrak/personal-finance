/**
 * Long-form content (help, privacy policy, terms) as Markdown per language, loaded only when
 * opened. English is the fallback. {{operator}} and {{email}} are filled in from src/brand.ts.
 */
import { OPERATOR, SUPPORT_EMAIL } from '../brand';

export type ContentKind = 'help' | 'privacy' | 'terms';

const files = import.meta.glob<string>('./*.md', { query: '?raw', import: 'default' });

export async function loadContent(kind: ContentKind, language: string): Promise<string> {
  const load = files[`./${kind}.${language}.md`] ?? files[`./${kind}.en.md`];
  const text = await load();
  return text.replace(/\{\{operator\}\}/g, OPERATOR).replace(/\{\{email\}\}/g, SUPPORT_EMAIL);
}
