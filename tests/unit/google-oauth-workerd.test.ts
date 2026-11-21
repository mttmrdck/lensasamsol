import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

describe('Google authorization in the actual workerd runtime', () => {
  let mf: Miniflare;
  let redirectResponse = false;
  const requests: string[] = [];
  beforeAll(async () => {
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
          import { exchangeCode } from './worker/google.ts';
          export default {async fetch() {
            try {
              const token = await exchangeCode({
                GOOGLE_CLIENT_ID: 'fixture-client', GOOGLE_CLIENT_SECRET: 'synthetic-client-secret',
                GOOGLE_ALLOWED_EMAIL: 'owner@example.test', PUBLIC_ORIGIN: 'https://staging.example.test'
              }, 'https://staging.example.test', 'synthetic-code', 'synthetic-verifier');
              return Response.json({ok:true, email:token.email});
            } catch(e) {
              return Response.json({ok:false, kind:e.kind, status:e.status,
                redirectLocationPresent:e.redirectLocationPresent});
            }
          }};
        `,
      },
      bundle: true,
      format: 'esm',
      platform: 'browser',
      write: false,
    });
    mf = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        compatibilityDate: '2026-11-01',
        script: bundle.outputFiles[0].text,
        outboundService: (request) => {
          requests.push(request.url);
          if (redirectResponse)
            return new Response(null, {
              status: 302,
              headers: {
                location: 'https://untrusted.invalid/?token=synthetic-private-marker',
              },
            });
          const claims = {
            email: 'owner@example.test',
            email_verified: true,
            aud: 'fixture-client',
            iss: 'https://accounts.google.com',
            exp: Math.floor(Date.now() / 1000) + 3600,
          };
          return Response.json({
            access_token: 'synthetic-access',
            refresh_token: 'synthetic-refresh',
            expires_in: 3600,
            scope: 'openid email https://www.googleapis.com/auth/drive.readonly',
            id_token: `fixture.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`,
          });
        },
      }),
    );
  });
  afterAll(async () => {
    await mf?.dispose();
  });

  it('reaches the mocked Google token endpoint without the redirect-mode TypeError', async () => {
    const response = await mf.dispatchFetch('http://localhost/');
    expect(await response.json()).toEqual({ ok: true, email: 'owner@example.test' });
    expect(requests).toEqual(['https://oauth2.googleapis.com/token']);
  });

  it('refuses a redirect without sending any request to the destination', async () => {
    redirectResponse = true;
    const response = await mf.dispatchFetch('http://localhost/');
    expect(await response.json()).toEqual({
      ok: false,
      kind: 'upstream',
      status: 302,
      redirectLocationPresent: true,
    });
    expect(requests).toEqual(['https://oauth2.googleapis.com/token', 'https://oauth2.googleapis.com/token']);
  });
});
