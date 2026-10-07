/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASES?: string;
  readonly VITE_APP_NAME?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
