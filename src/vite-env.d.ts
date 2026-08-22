/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASES?: string;
  readonly VITE_APP_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
