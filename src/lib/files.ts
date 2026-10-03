/** Preparing files for attachment: images are resized and compressed on the device. */

export interface PreparedFile {
  name: string;
  type: string;
  size: number;
  /** base64, without the data: prefix */
  data: string;
}

const MAX_SIDE = 1600;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Photos become JPEGs of at most 1600 px, stepping quality down to fit `maxBytes`. PDFs are kept as they are. */
export async function prepareFile(file: File, maxBytes: number): Promise<PreparedFile> {
  if (!file.type.startsWith('image/')) {
    return { name: file.name, type: file.type, size: file.size, data: toBase64(await file.arrayBuffer()) };
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let blob: Blob | null = null;
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    if (blob && blob.size <= maxBytes) break;
  }
  if (!blob) throw new Error('Could not read the image.');
  const name = file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
  return { name, type: 'image/jpeg', size: blob.size, data: toBase64(await blob.arrayBuffer()) };
}

export const dataUrl = (type: string, data: string) => `data:${type};base64,${data}`;

/** Opens an attachment in a new tab (PDFs) or downloads it. */
export function openAttachment(type: string, data: string, name: string): void {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url;
  if (type === 'application/pdf') a.target = '_blank';
  else a.download = name;
  a.rel = 'noopener';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Files shared into the app by the service worker's share target, removed once taken. */
export async function takeSharedFiles(maxBytes = 600 * 1024): Promise<PreparedFile[]> {
  if (typeof caches === 'undefined') return [];
  const cache = await caches.open('ledger-shared');
  const out: PreparedFile[] = [];
  for (const request of await cache.keys()) {
    const res = await cache.match(request);
    await cache.delete(request);
    if (!res) continue;
    const blob = await res.blob();
    const name = decodeURIComponent(res.headers.get('x-file-name') ?? 'receipt');
    out.push(await prepareFile(new File([blob], name, { type: blob.type }), maxBytes));
  }
  return out;
}
