import { Link } from 'react-router';
import type { Iou, Person } from '../db/types';
import { t } from '../i18n';
import { equalShare } from '../lib/friends';
import { formatMoney, type Pence } from '../lib/money';

/**
 * On an expense you paid: choose who shares it. Each friend owes an equal share, recorded when
 * the expense is saved (see splitWithPeople).
 */
export function SplitWithFriends({
  people,
  selected,
  onChange,
  amount,
  existing,
}: {
  people: Person[];
  selected: string[];
  onChange: (ids: string[]) => void;
  amount: Pence;
  existing: Iou[];
}) {
  const active = people.filter((p) => !p.archived);
  const share = equalShare(amount, selected.length);
  return (
    <section className="section" aria-labelledby="friends-split-label">
      <span className="section-label" id="friends-split-label">
        {t('friends.splitTitle')}
      </span>
      {active.length === 0 ? (
        <p className="small muted">
          {t('friends.splitNoFriends')} <Link to="/friends">{t('friends.addFirst')}</Link>
        </p>
      ) : (
        <>
          <div className="chips" role="group" aria-labelledby="friends-split-label">
            {active.map((p) => (
              <button
                key={p.id}
                type="button"
                className="chip"
                aria-pressed={selected.includes(p.id)}
                onClick={() => onChange(selected.includes(p.id) ? selected.filter((x) => x !== p.id) : [...selected, p.id])}
                translate="no"
              >
                {p.name}
              </button>
            ))}
          </div>
          {selected.length > 0 && amount > 0 && (
            <p className="small">{t('friends.splitEach', { count: selected.length, amount: formatMoney(share) })}</p>
          )}
          {existing.length > 0 && selected.length === 0 && (
            <p className="small muted">
              {t('friends.splitExisting', {
                names: existing.map((i) => people.find((p) => p.id === i.personId)?.name ?? '?').join(', '),
              })}
            </p>
          )}
        </>
      )}
    </section>
  );
}
