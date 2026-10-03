/**
 * On-device text recognition for receipts (Tesseract, WebAssembly). Everything runs in the
 * browser from files the app serves itself (/ocr/, see ocr-assets.ts); the image never leaves
 * the device. Loaded only when used.
 */
export async function recogniseText(image: Blob, onProgress?: (ratio: number) => void): Promise<string> {
  const { createWorker, OEM } = await import('tesseract.js');
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: '/ocr/worker.min.js',
    corePath: '/ocr/core',
    langPath: '/ocr/lang',
    gzip: true,
    // A blob: worker would need a weaker CSP; load the worker from our own origin instead.
    workerBlobURL: false,
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
