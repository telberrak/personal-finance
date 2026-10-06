/**
 * Long-form content (help, privacy policy, terms) as Markdown per language, loaded only when
 * opened. English is the fallback. {{operator}} and {{email}} are filled in from src/brand.ts (server settings).
 */
import { operatorName, supportEmail } from '../brand';

/** The long-form documents the app ships, one Markdown file per language. */
export type ContentKind = 'help' | 'privacy' | 'terms';

const files = import.meta.glob<string>('./*.md', { query: '?raw', import: 'default' });

/** Loads a document in a language (English if missing) and fills in the operator and support email. */
export async function loadContent(kind: ContentKind, language: string): Promise<string> {
  const load = files[`./${kind}.${language}.md`] ?? files[`./${kind}.en.md`];
  const text = await load();
  return text.replace(/\{\{operator\}\}/g, operatorName()).replace(/\{\{email\}\}/g, supportEmail());
}
