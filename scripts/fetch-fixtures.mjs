// Downloads demo fixture imagery (Unsplash License, served via picsum.photos) into public/__fixtures.
// Writes shared/demo-manifest.json with dimensions + attribution. Idempotent: skips files that exist.
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const SETS = {
  coast: [
    10, 12, 13, 14, 16, 37, 44, 46, 49, 52, 74, 77, 124, 135, 154, 164, 179, 199, 213, 174, 607, 613, 638,
    657, 1038, 1009, 842, 512, 997,
  ],
  city: [
    43, 57, 88, 122, 214, 221, 520, 522, 736, 740, 742, 898, 948, 949, 195, 263, 514, 1065, 78, 183, 133, 84,
    192, 193,
  ],
  portraits: [64, 65, 1027, 978, 758, 680, 550, 1003, 776, 91, 27, 103, 129, 173, 31, 22, 203, 177],
  highlands: [
    29, 79, 67, 537, 827, 829, 870, 873, 981, 1042, 806, 735, 591, 260, 15, 128, 166, 191, 62, 121, 141, 321,
    256,
  ],
  lights: [158, 56, 223, 220, 171, 149, 117, 184, 137],
};
export const VARIANTS = { s: 480, m: 960, l: 1600 };

const outDir = 'public/__fixtures';
const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

async function get(url, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (res.ok) return res;
    } catch {
      /* network error — retry with backoff */
    }
    await new Promise((r) => setTimeout(r, 800 * (i + 1)));
  }
  throw new Error(`Failed ${url}`);
}

const manifest = [];
const ids = [...new Set(Object.values(SETS).flat())];
let done = 0;
async function work(id) {
  const info = await (await get(`https://picsum.photos/id/${id}/info`)).json();
  const ar = info.width / info.height;
  const dims = {};
  for (const [v, long] of Object.entries(VARIANTS)) {
    const w = ar >= 1 ? long : Math.round(long * ar);
    const h = ar >= 1 ? Math.round(long / ar) : long;
    dims[v] = [w, h];
    const file = join(outDir, String(id), `${v}.webp`);
    if (!(await exists(file))) {
      await mkdir(join(outDir, String(id)), { recursive: true });
      const buf = Buffer.from(
        await (await get(`https://picsum.photos/id/${id}/${w}/${h}.webp`)).arrayBuffer(),
      );
      await writeFile(file, buf);
    }
  }
  manifest.push({
    id: String(id),
    sets: Object.entries(SETS)
      .filter(([, l]) => l.includes(id))
      .map(([k]) => k),
    author: info.author,
    sourceUrl: info.url,
    width: dims.l[0],
    height: dims.l[1],
  });
  done++;
  process.stdout.write(`\r${done}/${ids.length}`);
}
const queue = [...ids];
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) await work(queue.shift());
  }),
);
manifest.sort((a, b) => Number(a.id) - Number(b.id));
await writeFile(
  'shared/demo-manifest.json',
  JSON.stringify({ sets: SETS, variants: VARIANTS, images: manifest }, null, 1),
);
console.log('\nWrote shared/demo-manifest.json');
