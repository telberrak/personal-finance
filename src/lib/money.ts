/** All money is stored as integer pence to avoid floating-point drift. */
export type Pence = number;

const gbp = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

/** £1,234.50, −£23.40, or +£42.00 when `sign` is set and the amount is positive. */
export function formatMoney(pence: Pence, opts: { sign?: boolean } = {}): string {
  const body = gbp.format(Math.abs(pence) / 100);
  if (pence < 0) return '−' + body;
  if (opts.sign && pence > 0) return '+' + body;
  return body;
}

/** Whole pounds with no pence, for compact labels: £750. */
export function formatPounds(pence: Pence): string {
  return '£' + Math.round(pence / 100).toLocaleString('en-GB');
}

/** Parses user input such as "23.4", "£1,200" or "0.99" into pence. Returns null when invalid. */
export function parseMoney(input: string): Pence | null {
  const cleaned = input.replace(/[£,\s]/g, '');
  if (cleaned === '' || cleaned === '.' || !/^\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  return Number(whole || '0') * 100 + Number(frac.padEnd(2, '0'));
}
