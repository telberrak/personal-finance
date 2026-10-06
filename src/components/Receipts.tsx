/**
 * Receipts and documents on a transaction: add photos or PDFs (resized and encrypted like other data), read a
 * receipt on the device (OCR), and set return-by and warranty dates.
 */
import { useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { addAttachment, ATTACHMENT_TYPES, deleteAttachment, MAX_ATTACHMENT_BYTES, ValidationError } from '../db/repo';
import { t } from '../i18n';
import { dataUrl, openAttachment, prepareFile, type PreparedFile } from '../lib/files';
import { parseReceipt, type ReceiptGuess } from '../lib/receipt';
import { today } from '../lib/dates';
import { Icon } from './Icon';
import { useToast } from './ui/Toast';

interface Shown {
  key: string;
  name: string;
  type: string;
  data: string;
  remove: () => void;
}

/**
 * Receipts and documents on a transaction. For a new transaction they are kept here (`pending`)
 * and saved with it; on an existing one they are saved straight away. Photos can be read on the
 * device to fill in the amount, date and shop.
 */
export function Receipts({
  transactionId,
  pending,
  setPending,
  onRead,
}: {
  transactionId?: string;
  pending: PreparedFile[];
  setPending: (files: PreparedFile[]) => void;
  onRead: (guess: ReceiptGuess) => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<{ key: string; progress: number }>();
  const saved = useLiveQuery(
    () => (transactionId ? db.attachments.where('transactionId').equals(transactionId).toArray() : []),
    [transactionId],
    [],
  );

  async function add(files: FileList | null) {
    for (const file of Array.from(files ?? [])) {
      if (!ATTACHMENT_TYPES.includes(file.type) && !file.type.startsWith('image/')) {
        toast({ message: t('errors.attachmentType') });
        continue;
      }
      try {
        const prepared = await prepareFile(file, Math.min(MAX_ATTACHMENT_BYTES, 600 * 1024));
        if (prepared.size > MAX_ATTACHMENT_BYTES) throw new ValidationError(t('errors.attachmentSize'));
        if (transactionId) await addAttachment({ ...prepared, transactionId });
        else setPending([...pending, prepared]);
      } catch (err) {
        toast({ message: err instanceof ValidationError ? err.message : t('receipts.addFailed') });
      }
    }
  }

  async function read(item: Shown) {
    setReading({ key: item.key, progress: 0 });
    try {
      const { recogniseText } = await import('../lib/ocr');
      const bytes = Uint8Array.from(atob(item.data), (c) => c.charCodeAt(0));
      const text = await recogniseText(new Blob([bytes], { type: item.type }), (progress) => setReading({ key: item.key, progress }));
      const guess = parseReceipt(text, today());
      if (guess.amount === undefined && !guess.date && !guess.merchant) toast({ message: t('receipts.nothingFound') });
      else onRead(guess);
    } catch {
      toast({ message: t('receipts.readFailed') });
    } finally {
      setReading(undefined);
    }
  }

  const items: Shown[] = [
    ...saved.map((a) => ({ key: a.id, name: a.name, type: a.type, data: a.data, remove: () => void deleteAttachment(a.id) })),
    ...pending.map((p, i) => ({
      key: `pending-${i}`,
      name: p.name,
      type: p.type,
      data: p.data,
      remove: () => setPending(pending.filter((_, j) => j !== i)),
    })),
  ];

  return (
    <section className="section" aria-labelledby="receipts-label">
      <span className="section-label" id="receipts-label">
        {t('receipts.title')}
      </span>
      {items.length > 0 && (
        <ul className="receipts">
          {items.map((item) => (
            <li key={item.key} className="receipt">
              <button
                type="button"
                className="receipt-thumb plain-btn"
                onClick={() => openAttachment(item.type, item.data, item.name)}
                aria-label={t('receipts.open', { name: item.name })}
              >
                {item.type.startsWith('image/') ? (
                  <img src={dataUrl(item.type, item.data)} alt="" />
                ) : (
                  <span className="receipt-doc">{t('receipts.pdf')}</span>
                )}
              </button>
              <div className="stack" style={{ gap: 4, minWidth: 0 }}>
                <span className="small receipt-name" translate="no">
                  {item.name}
                </span>
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {item.type.startsWith('image/') && (
                    <button type="button" className="btn btn--sm" disabled={!!reading} onClick={() => void read(item)}>
                      {reading?.key === item.key
                        ? t('receipts.reading', { percent: Math.round(reading.progress * 100) })
                        : t('receipts.read')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={item.remove}
                    aria-label={t('receipts.remove', { name: item.name })}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => input.current?.click()}>
        <Icon name="upload" size={18} />
        {t('receipts.add')}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        aria-label={t('receipts.add')}
        onChange={(e) => {
          void add(e.target.files);
          e.target.value = '';
        }}
      />
      <p className="small muted">{t('receipts.note')}</p>
    </section>
  );
}
