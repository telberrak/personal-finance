/**
 * Serves Tesseract (on-device receipt reading) from the app itself under /ocr/, so no file is
 * fetched from a CDN and the CSP can stay 'self'. Copied into the build, served by the dev server.
 * The files are large (about 12 MB) and only downloaded when someone reads a receipt.
 */
import { createReadStream, readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

const FILES: Record<string, string> = {
  'ocr/worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js',
  'ocr/core/tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'ocr/core/tesseract-core-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js',
  // "best_int": accurate and the smallest English model (3 MB).
  'ocr/lang/eng.traineddata.gz': 'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
};

/** The Vite plugin (see the comment at the top of this file). */
export function ocrAssets(): Plugin {
  return {
    name: 'ledger-ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const source = FILES[(req.url ?? '').split('?')[0].replace(/^\//, '')];
        if (!source) return next();
        res.setHeader('content-type', source.endsWith('.gz') ? 'application/gzip' : 'text/javascript');
        createReadStream(source).pipe(res);
      });
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(FILES)) this.emitFile({ type: 'asset', fileName, source: readFileSync(source) });
    },
  };
}
