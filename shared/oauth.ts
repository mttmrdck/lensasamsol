// Only fixed public messages/codes cross the OAuth callback boundary.
export const OAUTH_FAILURE_MESSAGES = {
  consent_denied: 'Access was declined on the Google consent screen.',
  consent_failed: 'Google authorization did not complete. Start a new connection attempt.',
  state_invalid: 'The connection attempt expired or did not match this session. Please try again.',
  token_exchange_failed: 'Google could not complete the token exchange. Start a new connection attempt.',
  token_exchange_redirect:
    'Google returned an unexpected redirect during authorization. Please report this error.',
  google_identity_failed:
    'Google identity verification failed. Connect the Google account configured for this studio.',
  drive_scope_missing: 'Drive read access was not granted. Tick the Drive permission on the consent screen.',
  refresh_token_missing:
    'Google did not return offline access. Remove this app from your Google account connections, then reconnect.',
  token_encryption_failed: 'The server could not encrypt the Google connection. Please report this error.',
  connection_save_failed: 'The server could not save the Google connection. Please report this error.',
} as const;

export type OAuthFailureCode = keyof typeof OAUTH_FAILURE_MESSAGES;

export function oauthFailureMessage(code: string | null): string | null {
  if (!code) return null;
  return Object.hasOwn(OAUTH_FAILURE_MESSAGES, code)
    ? OAUTH_FAILURE_MESSAGES[code as OAuthFailureCode]
    : 'Google Drive connection failed. Start a new connection attempt.';
}
