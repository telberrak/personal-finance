/**
 * Random id. crypto.randomUUID only exists on secure origins, so it is missing when the
 * dev server is opened from a phone over plain http on the LAN; getRandomValues is not.
 */
export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
