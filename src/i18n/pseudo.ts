/**
 * Pseudo-locales for testing translations: en-XA (accented, longer text) and ar-XB (right to left). Each
 * string is wrapped in ⟦ ⟧ so untranslated text stands out in screenshots and tests.
 */
const ACCENTS: Record<string, string> = {
  a: 'à',
  b: 'ƀ',
  c: 'ç',
  d: 'ð',
  e: 'é',
  f: 'ƒ',
  g: 'ĝ',
  h: 'ĥ',
  i: 'î',
  j: 'ĵ',
  k: 'ķ',
  l: 'ĺ',
  m: 'ɱ',
  n: 'ñ',
  o: 'ö',
  p: 'ƥ',
  q: 'ʠ',
  r: 'ŕ',
  s: 'š',
  t: 'ţ',
  u: 'û',
  v: 'ṽ',
  w: 'ŵ',
  x: 'ẋ',
  y: 'ý',
  z: 'ž',
  A: 'Å',
  B: 'Ɓ',
  C: 'Ç',
  D: 'Ð',
  E: 'É',
  F: 'Ƒ',
  G: 'Ĝ',
  H: 'Ĥ',
  I: 'Î',
  J: 'Ĵ',
  K: 'Ķ',
  L: 'Ļ',
  M: 'Ṁ',
  N: 'Ñ',
  O: 'Ö',
  P: 'Ƥ',
  Q: 'Ǫ',
  R: 'Ŕ',
  S: 'Š',
  T: 'Ţ',
  U: 'Û',
  V: 'Ṽ',
  W: 'Ŵ',
  X: 'Ẋ',
  Y: 'Ý',
  Z: 'Ž',
};

/** Marks the start and end of every translated string, so untranslated text stands out in tests. */
export const PSEUDO_OPEN = '⟦';
/** Marks the end of a translated string in pseudo-locales, so tests can spot text that was not translated. */
export const PSEUDO_CLOSE = '⟧';

/** "Save {{name}}" → "⟦Šàṽé {{name}} ~~~⟧": accented, about 40% longer, placeholders untouched. */
export function pseudoString(s: string): string {
  const parts = s.split(/(\{\{[^}]+\}\}|<\/?\d+>)/);
  const body = parts.map((p, i) => (i % 2 ? p : p.replace(/[a-zA-Z]/g, (c) => ACCENTS[c] ?? c))).join('');
  const letters = s.replace(/\{\{[^}]+\}\}/g, '').length;
  return PSEUDO_OPEN + body + (letters > 3 ? ' ' + '~'.repeat(Math.ceil(letters * 0.4)) : '') + PSEUDO_CLOSE;
}

type Tree = { [key: string]: string | Tree };

/**
 * Pseudo-translates a resource tree. Plural "_other" strings are copied to every CLDR plural
 * category, so pseudo-locales using other plural rules (Arabic has six) never fall back to English.
 */
export function pseudoLocalise(tree: Tree): Tree {
  const out: Tree = {};
  for (const [k, v] of Object.entries(tree)) {
    if (typeof v !== 'string') {
      out[k] = pseudoLocalise(v);
      continue;
    }
    out[k] = pseudoString(v);
    if (k.endsWith('_other')) {
      const base = k.slice(0, -'_other'.length);
      for (const form of ['zero', 'two', 'few', 'many']) if (!(`${base}_${form}` in tree)) out[`${base}_${form}`] = pseudoString(v);
    }
  }
  return out;
}
