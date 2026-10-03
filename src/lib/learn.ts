/**
 * Learns categories from your own history, on the device: a small naive Bayes classifier over the
 * words in payee names. "Tesco Express" and "Tesco Metro" share "tesco"; a new "Corner Deli" can
 * borrow from other "deli" payees you have categorised. Nothing is uploaded.
 */
import type { Transaction } from '../db/types';
import { payeeKey } from './payees';

interface Model {
  /** category → number of transactions */
  docs: Map<string, number>;
  /** category → word → count */
  words: Map<string, Map<string, number>>;
  totals: Map<string, number>;
  vocabulary: Set<string>;
  n: number;
}

const tokens = (payee: string) => [
  ...new Set(
    payeeKey(payee)
      .split(' ')
      .filter((w) => w.length > 1 && !/^\d+$/.test(w)),
  ),
];

const cache = new WeakMap<Transaction[], Model>();

function train(history: Transaction[]): Model {
  const cached = cache.get(history);
  if (cached) return cached;
  const model: Model = { docs: new Map(), words: new Map(), totals: new Map(), vocabulary: new Set(), n: 0 };
  // The most recent 3,000 are plenty, and keep this fast.
  for (const t of history.slice(0, 3000)) {
    if (t.transferId || t.categoryId === 'other' || t.categoryId === 'other-income') continue;
    model.n += 1;
    model.docs.set(t.categoryId, (model.docs.get(t.categoryId) ?? 0) + 1);
    const counts = model.words.get(t.categoryId) ?? new Map<string, number>();
    for (const w of tokens(t.payee)) {
      counts.set(w, (counts.get(w) ?? 0) + 1);
      model.totals.set(t.categoryId, (model.totals.get(t.categoryId) ?? 0) + 1);
      model.vocabulary.add(w);
    }
    model.words.set(t.categoryId, counts);
  }
  cache.set(history, model);
  return model;
}

/**
 * The most likely category for a payee among `allowed`, with its probability, or undefined when
 * there is too little to go on (no known words, or less than `minConfidence` sure).
 */
export function learnedCategory(
  payee: string,
  history: Transaction[],
  allowed: Set<string>,
  minConfidence = 0.6,
): { categoryId: string; confidence: number } | undefined {
  const model = train(history);
  const words = tokens(payee).filter((w) => model.vocabulary.has(w));
  if (!words.length || model.n < 5) return undefined;
  const v = model.vocabulary.size;
  const scores: [string, number][] = [];
  for (const [category, docs] of model.docs) {
    if (!allowed.has(category)) continue;
    const counts = model.words.get(category)!;
    const total = model.totals.get(category) ?? 0;
    let score = Math.log(docs / model.n);
    for (const w of words) score += Math.log(((counts.get(w) ?? 0) + 1) / (total + v));
    scores.push([category, score]);
  }
  if (!scores.length) return undefined;
  const max = Math.max(...scores.map(([, s]) => s));
  const sum = scores.reduce((s, [, x]) => s + Math.exp(x - max), 0);
  const [best, bestScore] = scores.reduce((a, b) => (b[1] > a[1] ? b : a));
  const confidence = Math.exp(bestScore - max) / sum;
  return confidence >= minConfidence ? { categoryId: best, confidence } : undefined;
}
