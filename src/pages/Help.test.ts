import { describe, expect, it } from 'vitest';
import ar from '../content/help.ar.md?raw';
import en from '../content/help.en.md?raw';
import fr from '../content/help.fr.md?raw';
import { helpTopics, searchTopics } from './Help';

const FILES: Record<string, string> = { en, fr, ar };
const read = (language: string) => FILES[language];

describe('help', () => {
  const en = helpTopics(read('en'));

  it('has the same topics, in the same order, in every language', () => {
    const ids = en.topics.map((topic) => topic.id);
    expect(ids).toContain('bills');
    expect(new Set(ids).size).toBe(ids.length);
    for (const language of ['fr', 'ar']) {
      const { intro, topics } = helpTopics(read(language));
      expect(intro).not.toBe('');
      expect(topics.map((topic) => topic.id)).toEqual(ids);
      for (const topic of topics) expect(topic.body.length, `${language}#${topic.id}`).toBeGreaterThan(50);
    }
  });

  it('finds topics by every word searched for, ignoring case and accents', () => {
    expect(searchTopics(en.topics, '').length).toBe(en.topics.length);
    expect(searchTopics(en.topics, 'RECOVERY key').map((t) => t.id)).toContain('sync');
    expect(searchTopics(en.topics, 'recovery zebra')).toEqual([]);
    const fr = helpTopics(read('fr'));
    expect(searchTopics(fr.topics, 'depense').length).toBeGreaterThan(0); // finds "dépense"
  });
});
