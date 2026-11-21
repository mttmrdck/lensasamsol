import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import sharp from 'sharp';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

describe('private media derivatives in workerd with the real local Images codec', () => {
  let mf: Miniflare;
  const originals = new Map<string, Buffer>();
  const requests: string[] = [];
  let mediaRequests = 0;
  beforeAll(async () => {
    const svg = Buffer.from(
      '<svg width="3600" height="2400" xmlns="http://www.w3.org/2000/svg"><defs><pattern id="p" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="20" height="40" fill="#333"/><rect x="20" width="20" height="40" fill="#ddd"/></pattern></defs><rect width="100%" height="100%" fill="url(#p)"/></svg>',
    );
    for (const [name, orientation] of [
      ['portrait', 6],
      ['landscape', 1],
    ] as const) {
      originals.set(name, await sharp(svg).jpeg().withMetadata({ orientation }).toBuffer());
    }
    const bundle = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
      import {fetchDrivePreview} from './worker/google.ts';
      import {imageRoutes} from './worker/images.ts';
      import {encryptSecret} from './worker/crypto.ts';
      const key=btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));
      export default {async fetch(request,env,ctx){
        const u=new URL(request.url);const file=u.searchParams.get('file');const edge=Number(u.searchParams.get('edge'));
        const row={email:'owner@example.test',connected_at:'synthetic-epoch',refresh_token_enc:'synthetic-encrypted-refresh',access_token_enc:await encryptSecret('synthetic-access',key),access_expires_at:Date.now()+60000};
        Object.assign(env,{APP_ENV:'staging',GOOGLE_CLIENT_ID:'fixture',GOOGLE_CLIENT_SECRET:'fixture',GOOGLE_ALLOWED_EMAIL:'owner@example.test',TOKEN_ENCRYPTION_KEY:key,DB:{prepare(sql){let args=[];const statement={bind(...a){args=a;return statement;},first:async()=>sql.includes('FROM photos')?{drive_file_id:args[0].includes('portrait')?'portrait':'landscape',resource_key:null,source_version:'fixture-v1',source:'drive',demo_asset:null}:row};return statement;}}});
        if(u.pathname.startsWith('/t/'))return imageRoutes.fetch(request,env,ctx);
        return (await fetchDrivePreview(env,file,null,edge)).res;
      }};`,
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
        images: { binding: 'IMAGES' },
        outboundService: (request) => {
          const u = new URL(request.url);
          requests.push(u.hostname);
          const file = u.pathname.split('/').pop()!;
          const bytes = originals.get(file)!;
          if (u.searchParams.get('alt') === 'media') {
            mediaRequests++;
            return new Response(new Uint8Array(bytes), {
              headers: { 'content-type': 'image/jpeg', 'content-length': String(bytes.length) },
            });
          }
          return Response.json({
            mimeType: 'image/jpeg',
            size: String(bytes.length),
            version: 'fixture-v1',
            capabilities: { canDownload: true },
          });
        },
      }),
    );
  }, 20000);
  afterAll(async () => {
    await mf?.dispose();
  });

  it.each([
    ['portrait', 480, 320, 480],
    ['portrait', 960, 640, 960],
    ['portrait', 1600, 1067, 1600],
    ['portrait', 2560, 1707, 2560],
    ['landscape', 480, 480, 320],
    ['landscape', 960, 960, 640],
    ['landscape', 1600, 1600, 1067],
    ['landscape', 2560, 2560, 1707],
  ])('delivers %s at %spx as an oriented, metadata-free %s×%s WebP', async (file, edge, width, height) => {
    const res = await mf.dispatchFetch(`http://localhost/?file=${file}&edge=${edge}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    const bytes = Buffer.from(await res.arrayBuffer());
    const metadata = await sharp(bytes).metadata();
    expect(metadata.width).toBe(width);
    expect(metadata.height).toBe(height);
    expect(metadata.exif).toBeUndefined();
    expect(metadata.orientation).toBeUndefined();
    expect(bytes.length).toBeLessThan(originals.get(file as string)!.length);
    expect(res.headers.has('authorization')).toBe(false);
    expect(res.headers.has('location')).toBe(false);
  });

  it('serves a private route derivative and reuses its completed xl master for the viewer', async () => {
    const before = mediaRequests;
    const grid = await mf.dispatchFetch('http://localhost/t/syntheticGalleryToken000001/ph_portrait0001/m');
    const gridMetadata = await sharp(Buffer.from(await grid.arrayBuffer())).metadata();
    expect(gridMetadata.width).toBe(640);
    expect(gridMetadata.height).toBe(960);
    expect(grid.headers.get('cache-control')).toBe('private, no-store');
    expect(mediaRequests - before).toBe(1);
    const viewer = await mf.dispatchFetch(
      'http://localhost/t/syntheticGalleryToken000001/ph_portrait0001/xl',
    );
    const viewerMetadata = await sharp(Buffer.from(await viewer.arrayBuffer())).metadata();
    expect(viewerMetadata.width).toBe(1707);
    expect(viewerMetadata.height).toBe(2560);
    expect(viewer.headers.get('cache-control')).toBe('private, no-store');
    expect(mediaRequests - before).toBe(1);
    expect(viewerMetadata.exif).toBeUndefined();
    expect(new Set(requests)).toEqual(new Set(['www.googleapis.com']));
  });
});
