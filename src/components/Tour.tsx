import { useState } from 'react';
import { updateSettings } from '../db/repo';
import { t } from '../i18n';
import { Sheet } from './ui/Dialog';

const STEPS = ['safe', 'add', 'bills', 'more'] as const;

/** A short first-run tour after setting up your own account (not for demo data). */
export function Tour({ show }: { show: boolean }) {
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(true);
  // Closes once "done" is saved, so leaving or reloading straight away never brings it back.
  const finish = () => void updateSettings({ tourDone: true }).finally(() => setOpen(false));
  const id = STEPS[step];
  const last = step === STEPS.length - 1;
  return (
    <Sheet open={show && open} onClose={finish} title={t(`tour.${id}.title`)}>
      <div className="stack" style={{ gap: 16 }}>
        <p>{t(`tour.${id}.body`)}</p>
        <p className="small muted">{t('tour.step', { n: step + 1, total: STEPS.length })}</p>
        <div className="grid-2">
          <button type="button" className="btn" onClick={finish}>
            {t('tour.skip')}
          </button>
          <button type="button" className="btn btn--solid" onClick={() => (last ? finish() : setStep(step + 1))}>
            {last ? t('tour.done') : t('tour.next')}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
