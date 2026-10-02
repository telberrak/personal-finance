import type { ISODate } from '../lib/dates';
import { formatShort } from '../lib/dates';
import { formatMoney, formatPounds, type Pence } from '../lib/money';

/** Ring chart. Colours are CSS colour values (usually var(--cat-…)). */
export function Donut({
  segments,
  size = 180,
  thickness = 22,
  center,
  label,
}: {
  segments: { value: number; color: string }[];
  size?: number;
  thickness?: number;
  center?: React.ReactNode;
  label: string;
}) {
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const total = segments.reduce((s, x) => s + x.value, 0);
  let offset = 0;
  const gap = segments.length > 1 ? 2 : 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--track)" strokeWidth={thickness} />
        {total > 0 &&
          segments.map((s, i) => {
            const len = (s.value / total) * c;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={s.color}
                strokeWidth={thickness}
                strokeDasharray={`${Math.max(0, len - gap)} ${c}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            );
            offset += len;
            return el;
          })}
      </svg>
      {center && <div className="donut-center">{center}</div>}
    </div>
  );
}

/** Side-by-side bars per group (e.g. income and spending per month), with an accessible table. */
export function GroupedBars({
  groups,
  series,
  caption,
}: {
  groups: { label: string; values: number[] }[];
  series: { name: string; color: string }[];
  caption: string;
}) {
  const max = Math.max(1, ...groups.flatMap((g) => g.values));
  return (
    <figure className="bars-figure">
      <div className="bars" aria-hidden="true">
        {groups.map((g) => (
          <div key={g.label} className="bars-group">
            <div className="bars-cols">
              {g.values.map((v, i) => (
                <span
                  key={i}
                  className="bars-bar"
                  style={{ height: `${Math.max(1, (v / max) * 100)}%`, background: series[i].color }}
                  title={formatMoney(v)}
                />
              ))}
            </div>
            <span className="bars-label">{g.label}</span>
          </div>
        ))}
      </div>
      <figcaption className="row small" style={{ gap: 16 }}>
        {series.map((s) => (
          <span key={s.name} className="row" style={{ gap: 6 }}>
            <span className="dot" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </figcaption>
      <table className="visually-hidden">
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            {series.map((s) => (
              <th key={s.name} scope="col">
                {s.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <tr key={g.label}>
              <th scope="row">{g.label}</th>
              {g.values.map((v, i) => (
                <td key={i}>{formatMoney(v)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Balance over time with an optional warning threshold line. */
export function BalanceLine({
  points,
  threshold,
  label,
}: {
  points: { date: ISODate; balance: Pence }[];
  threshold?: Pence;
  label: string;
}) {
  const W = 600;
  const H = 180;
  const pad = 8;
  if (points.length < 2) return null;
  const values = points.map((p) => p.balance).concat(threshold !== undefined ? [threshold] : [], [0]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const y = (v: number) => pad + (1 - (v - min) / span) * (H - pad * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
  const area = `${path} L${x(points.length - 1)},${H - pad} L${x(0)},${H - pad} Z`;
  const lowestIndex = points.reduce((lo, p, i) => (p.balance < points[lo].balance ? i : lo), 0);
  return (
    <figure className="line-figure">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="line-svg">
        <path d={area} fill="var(--accent-soft)" />
        {min < 0 && <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} stroke="var(--border)" strokeWidth="1" />}
        {threshold !== undefined && (
          <line
            x1={pad}
            x2={W - pad}
            y1={y(threshold)}
            y2={y(threshold)}
            stroke="var(--warn)"
            strokeWidth="1.5"
            strokeDasharray="5 5"
            vectorEffect="non-scaling-stroke"
          />
        )}
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
        <circle
          cx={x(lowestIndex)}
          cy={y(points[lowestIndex].balance)}
          r="5"
          fill="var(--surface)"
          stroke="var(--accent)"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <div className="row small muted" style={{ justifyContent: 'space-between' }}>
        <span>{formatShort(points[0].date)}</span>
        <span>
          Lowest {formatPounds(points[lowestIndex].balance)} on {formatShort(points[lowestIndex].date)}
        </span>
        <span>{formatShort(points[points.length - 1].date)}</span>
      </div>
    </figure>
  );
}
