/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Reserved for future env vars — v1 has none.
  readonly _placeholder?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare const __APP_VERSION__: string
