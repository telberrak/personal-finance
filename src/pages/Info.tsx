/**
 * About (version, service status, what's new, feedback, usage counts) and the privacy policy and terms pages.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { APP_NAME, APP_VERSION, supportEmail } from '../brand';
import { Loading, PageHeader } from '../components/Layout';
import { Markdown } from '../components/Markdown';
import { Field } from '../components/ui/forms';
import { useToast } from '../components/ui/Toast';
import { loadContent, type ContentKind } from '../content';
import { updateSettings } from '../db/repo';
import type { FinanceData } from '../db/types';
import { currentLanguage, t } from '../i18n';
import { api } from '../sync/client';
import changelog from '../../CHANGELOG.md?raw';

/** Privacy policy or terms, in the interface language. */
export function ContentPage({ data, kind }: { data?: FinanceData; kind: ContentKind }) {
  // The language on screen (Settings, or a ?locale= link from the website).
  const language = data ? currentLanguage() : 'en';
  const [text, setText] = useState<{ key: string; body: string }>();
  const key = `${kind}.${language}`;
  useEffect(() => {
    let live = true;
    void loadContent(kind, language).then((body) => live && setText({ key, body }));
    return () => {
      live = false;
    };
  }, [kind, language, key]);
  if (!data || text?.key !== key) return <Loading />;
  return (
    <main className="screen screen--modal">
      <Link to="/settings/about" className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }}>
        {t('about.back')}
      </Link>
      <Markdown source={text.body} />
    </main>
  );
}

/** Version, what's new, service status, feedback, usage counts and legal links. */
export function About({ data }: { data?: FinanceData }) {
  const toast = useToast();
  const [status, setStatus] = useState<'checking' | 'ok' | 'down' | 'none'>('checking');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api<{ ok: boolean }>('/health')
      .then((r) => setStatus(r.ok ? 'ok' : 'down'))
      .catch((err: { status?: number }) => setStatus(err.status === 0 ? 'none' : 'down'));
  }, []);

  if (!data) return <Loading />;
  // The three latest releases.
  const recent = changelog
    .split(/\n(?=## )/)
    .slice(1, 4)
    .join('\n');

  async function send(e: FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await api('/feedback', { body: { message, email, version: APP_VERSION, language: data!.settings.language } });
      setMessage('');
      setEmail('');
      toast({ message: t('about.feedbackSent') });
    } catch {
      toast({ message: t('about.feedbackFailed', { email: supportEmail() }) });
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="screen screen--modal">
      <PageHeader title={t('about.title', { name: APP_NAME })} subtitle={t('about.version', { version: APP_VERSION })} />
      <Link to="/settings" className="link-btn" style={{ alignSelf: 'flex-start', padding: 0 }}>
        {t('common.backToSettings')}
      </Link>

      <section className="section">
        <div className="list">
          <Link className="list-row list-row--link" to="/help">
            {t('about.help')}
          </Link>
          <Link className="list-row list-row--link" to="/privacy">
            {t('about.privacy')}
          </Link>
          <Link className="list-row list-row--link" to="/terms">
            {t('about.terms')}
          </Link>
          <a className="list-row list-row--link" href={`mailto:${supportEmail()}`}>
            {t('about.contact', { email: supportEmail() })}
          </a>
        </div>
        <p className="small muted" role="status" style={{ padding: '0 4px' }}>
          {t(`about.status.${status}`)}
        </p>
      </section>

      <section className="section" aria-labelledby="feedback-title">
        <h2 className="section-label" id="feedback-title">
          {t('about.feedback')}
        </h2>
        <form className="stack" style={{ gap: 10 }} onSubmit={send}>
          <div className="list">
            <Field label={t('about.message')}>
              {(id) => <textarea id={id} rows={4} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} required />}
            </Field>
            <Field label={t('about.replyTo')}>
              {(id) => (
                <input
                  id={id}
                  type="email"
                  autoComplete="email"
                  placeholder={t('fields.optional')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              )}
            </Field>
          </div>
          <p className="small muted">{t('about.feedbackNote')}</p>
          <button type="submit" className="btn btn--solid" style={{ alignSelf: 'flex-start' }} disabled={sending || !message.trim()}>
            {t('about.sendFeedback')}
          </button>
        </form>
      </section>

      <section className="section">
        <h2 className="section-label">{t('about.privacyChoices')}</h2>
        <label className="check-row">
          <input type="checkbox" checked={!!data.settings.shareUsage} onChange={(e) => updateSettings({ shareUsage: e.target.checked })} />
          <span>
            {t('about.shareUsage')}
            <span className="small muted" style={{ display: 'block' }}>
              {t('about.shareUsageHint')}
            </span>
          </span>
        </label>
      </section>

      <section className="section" aria-labelledby="whats-new">
        <h2 className="section-label" id="whats-new">
          {t('about.whatsNew')}
        </h2>
        <div className="card" translate="no" lang="en">
          <Markdown source={recent} />
        </div>
      </section>
    </main>
  );
}
