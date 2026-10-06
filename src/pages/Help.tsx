/**
 * Help: the help file for the interface language, split into searchable topics that open on a tap. A link
 * such as /help#bills opens one topic.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router';
import { Icon } from '../components/Icon';
import { Loading, PageHeader } from '../components/Layout';
import { headingAnchor, Markdown } from '../components/Markdown';
import { loadContent } from '../content';
import type { FinanceData } from '../db/types';
import { currentLanguage, t } from '../i18n';

interface Topic {
  id: string;
  title: string;
  body: string;
  /** Title and text, lower-cased and without accents, for searching. */
  text: string;
}

/** Lower case without accents or Arabic diacritics, so "depense" finds "Dépense". */
const fold = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** Splits the help file into its intro and one topic per "## Title {#anchor}" section. */
export function helpTopics(source: string): { intro: string; topics: Topic[] } {
  const [head, ...parts] = source.replace(/\r\n/g, '\n').split(/\n(?=## )/);
  const intro = head.replace(/^# .*\n?/, '').trim();
  const topics = parts.map((part, i) => {
    const newline = part.indexOf('\n');
    const [title, id] = headingAnchor(part.slice(3, newline < 0 ? undefined : newline).trim());
    const body = newline < 0 ? '' : part.slice(newline + 1).trim();
    return { id: id ?? `topic-${i}`, title, body, text: fold(`${title}\n${body}`) };
  });
  return { intro, topics };
}

/** Every topic matching all the words searched for. */
export function searchTopics(topics: Topic[], query: string): Topic[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return words.length ? topics.filter((topic) => words.every((w) => topic.text.includes(w))) : topics;
}

/** Help: how each feature works, with examples, searchable, in the interface language. */
export function Help({ data }: { data?: FinanceData }) {
  const language = data ? currentLanguage() : 'en';
  const [source, setSource] = useState<{ language: string; text: string }>();
  const [query, setQuery] = useState('');
  const { hash } = useLocation();

  useEffect(() => {
    let live = true;
    void loadContent('help', language).then((text) => live && setSource({ language, text }));
    return () => {
      live = false;
    };
  }, [language]);

  const parsed = useMemo(() => (source ? helpTopics(source.text) : undefined), [source]);
  const target = decodeURIComponent(hash.slice(1));

  // A link such as /help#bills opens that topic and scrolls to it.
  useEffect(() => {
    if (parsed && target) document.getElementById(target)?.scrollIntoView({ block: 'start' });
  }, [parsed, target]);

  if (!data || !parsed || source?.language !== language) return <Loading />;
  const shown = searchTopics(parsed.topics, query);
  const searching = query.trim() !== '';

  return (
    <main className="screen">
      <PageHeader title={t('help.title')} />
      {parsed.intro && <p className="label help-intro">{parsed.intro}</p>}
      <label className="search">
        <Icon name="search" size={18} />
        <span className="visually-hidden">{t('help.search')}</span>
        <input
          type="search"
          placeholder={t('help.searchPlaceholder')}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          enterKeyHint="search"
        />
      </label>
      {shown.length === 0 && <p className="empty">{t('help.noMatch')}</p>}
      <div className="help-topics">
        {shown.map((topic) => (
          // Remounted when searching starts or stops, so matches open and the rest close again.
          <details key={`${topic.id}:${searching}`} id={topic.id} className="card help-topic" open={searching || target === topic.id}>
            <summary>
              <h2>{topic.title}</h2>
              <Icon name="down" size={18} />
            </summary>
            <Markdown source={topic.body} />
          </details>
        ))}
      </div>
    </main>
  );
}
