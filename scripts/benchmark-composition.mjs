import { createServer } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const server = await createServer({ configFile: false, server: { middlewareMode: true }, appType: 'custom' });
try {
  const { TEMPLATES, arrangeStyle, compositionLayout, qualityMetrics } =
    await server.ssrLoadModule('/shared/composition.ts');
  const { DEFAULT_STYLE } = await server.ssrLoadModule('/shared/style.ts');
  const manifest = JSON.parse(readFileSync('shared/demo-manifest.json', 'utf8'));
  const results = [];
  for (const count of [20, 500, 1200]) {
    const photos = Array.from({ length: count }, (_, i) => {
      const img = manifest.images[(i * 7) % manifest.images.length];
      return { id: `p${i}`, w: img.width, h: img.height, featured: i % 71 === 0 };
    });
    for (const template of TEMPLATES)
      for (const width of [336, 358, 720, 976, 1344]) {
        const style = arrangeStyle(DEFAULT_STYLE, photos, null, template.id);
        for (let i = 0; i < 10; i++) compositionLayout(photos, width, style);
        const times = [];
        for (let i = 0; i < 100; i++) {
          const start = performance.now();
          compositionLayout(photos, width, style);
          times.push(performance.now() - start);
        }
        times.sort((a, b) => a - b);
        const layout = compositionLayout(photos, width, style);
        results.push({
          count,
          template: template.id,
          width,
          medianMs: +times[50].toFixed(3),
          p95Ms: +times[95].toFixed(3),
          maxMs: +times[99].toFixed(3),
          ...qualityMetrics(layout, width),
        });
      }
  }
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/composition-benchmark.json', JSON.stringify(results, null, 2));
  console.log(
    JSON.stringify(
      {
        cases: results.length,
        largest: results
          .filter((r) => r.count === 1200)
          .map(({ template, width, medianMs, p95Ms }) => ({ template, width, medianMs, p95Ms })),
        under10msP95: results.every((r) => r.p95Ms < 10),
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
