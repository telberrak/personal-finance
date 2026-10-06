import type { ReactNode } from 'react';

const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * A small Markdown renderer for the app's own content (help, privacy, terms, changelog):
 * headings (with an optional `{#anchor}`), paragraphs, bullet and numbered lists, `>` example
 * boxes, **bold**, `code` and [links](https://…). It builds React elements, never HTML strings,
 * so content cannot inject markup.
 */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(((?:https?:\/\/|\/|mailto:)[^)\s]+)\)/g;
  let last = 0;
  let i = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={`${key}-${i++}`}>{m[1]}</strong>);
    else if (m[2]) out.push(<code key={`${key}-${i++}`}>{m[2]}</code>);
    else {
      const external = /^https?:/.test(m[4]);
      out.push(
        <a key={`${key}-${i++}`} href={m[4]} {...(external ? EXTERNAL : {})}>
          {m[3]}
        </a>,
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** A heading's text and its `{#anchor}`, if any: "Bills {#bills}" → ["Bills", "bills"]. */
export function headingAnchor(text: string): [string, string | undefined] {
  const m = text.match(/^(.*?)\s*\{#([\w-]+)\}$/);
  return m ? [m[1], m[2]] : [text, undefined];
}

/** Renders the app's own Markdown content (see the comment at the top of this file). */
export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: string[] = [];
  let ordered = false;
  let quote: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push(<p key={`p${blocks.length}`}>{inline(paragraph.join(' '), `p${blocks.length}`)}</p>);
    if (list.length) {
      const List = ordered ? 'ol' : 'ul';
      blocks.push(
        <List key={`u${blocks.length}`}>
          {list.map((item, i) => (
            <li key={i}>{inline(item, `l${blocks.length}-${i}`)}</li>
          ))}
        </List>,
      );
    }
    if (quote.length)
      blocks.push(
        <blockquote key={`q${blocks.length}`} className="example">
          {inline(quote.join(' '), `q${blocks.length}`)}
        </blockquote>,
      );
    paragraph = [];
    list = [];
    quote = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    const item = line.match(/^(?:[-*]|(\d+)\.)\s+(.*)$/);
    if (heading) {
      flush();
      const Tag = (['h1', 'h2', 'h3'] as const)[heading[1].length - 1];
      const [text, id] = headingAnchor(heading[2]);
      blocks.push(
        <Tag key={`h${blocks.length}`} id={id}>
          {inline(text, `h${blocks.length}`)}
        </Tag>,
      );
    } else if (item) {
      const isOrdered = item[1] !== undefined;
      if (paragraph.length || quote.length || (list.length && ordered !== isOrdered)) flush();
      ordered = isOrdered;
      list.push(item[2]);
    } else if (line.startsWith('>')) {
      if (paragraph.length || list.length) flush();
      quote.push(line.replace(/^>\s?/, ''));
    } else if (!line.trim()) flush();
    else {
      if (list.length || quote.length) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return <div className="prose">{blocks}</div>;
}
