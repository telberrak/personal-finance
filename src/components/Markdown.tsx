import type { ReactNode } from 'react';

const EXTERNAL = { target: '_blank', rel: 'noopener noreferrer' } as const;

/**
 * A small Markdown renderer for the app's own content (help, privacy, terms, changelog):
 * headings, paragraphs, bullet lists, **bold**, `code` and [links](https://…). It builds React
 * elements, never HTML strings, so content cannot inject markup.
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

export function Markdown({ source }: { source: string }) {
  const blocks: ReactNode[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let paragraph: string[] = [];
  let list: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push(<p key={`p${blocks.length}`}>{inline(paragraph.join(' '), `p${blocks.length}`)}</p>);
    if (list.length)
      blocks.push(
        <ul key={`u${blocks.length}`}>
          {list.map((item, i) => (
            <li key={i}>{inline(item, `l${blocks.length}-${i}`)}</li>
          ))}
        </ul>,
      );
    paragraph = [];
    list = [];
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      flush();
      const Tag = (['h1', 'h2', 'h3'] as const)[heading[1].length - 1];
      blocks.push(<Tag key={`h${blocks.length}`}>{inline(heading[2], `h${blocks.length}`)}</Tag>);
    } else if (/^[-*]\s+/.test(line)) {
      if (paragraph.length) flush();
      list.push(line.replace(/^[-*]\s+/, ''));
    } else if (!line.trim()) flush();
    else {
      if (list.length) flush();
      paragraph.push(line.trim());
    }
  }
  flush();
  return <div className="prose">{blocks}</div>;
}
