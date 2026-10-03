/** Build-time values (vite.config.ts `define` and VITE_* environment variables). */
declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_OPERATOR_NAME?: string;
  readonly VITE_API_ORIGIN?: string;
}
