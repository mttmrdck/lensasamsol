import type { PreviewImagesBinding } from './image-delivery';

export interface Env {
  APP_ENV?: 'development' | 'staging' | 'production';
  /** Account allowed to connect Drive; required outside local development. */
  GOOGLE_ALLOWED_EMAIL?: string;
  DB: D1Database;
  ASSETS: Fetcher;
  /** Streaming private derivatives, configured independently for each environment. */
  IMAGES?: PreviewImagesBinding;
  /** "true" enables seeded demo collections (fixture imagery). Must be "false" in production. */
  DEMO_MODE?: string;
  /** Canonical public origin, e.g. https://gallery.example.com — used for OAuth redirect + CSRF origin check. */
  PUBLIC_ORIGIN?: string;
  /** pbkdf2$sha256$<iterations>$<salt b64>$<hash b64> — generate with `npm run hash-password`. */
  ADMIN_CREDENTIALS_JSON?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD_HASH?: string;
  /** 32-byte base64 key for AES-GCM encryption of Google tokens — generate with `npm run gen-key`. */
  TOKEN_ENCRYPTION_KEY?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Optional: enables Google Picker in the create flow. Browser API key restricted to your origin. */
  GOOGLE_PICKER_API_KEY?: string;
  /** Optional: Google Cloud project number (Picker appId). */
  GOOGLE_PROJECT_NUMBER?: string;
}

export const isDemo = (env: Env): boolean => env.DEMO_MODE === 'true';

export type AppEnv = { Bindings: Env; Variables: { admin: boolean } };
