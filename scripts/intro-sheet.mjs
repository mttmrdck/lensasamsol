// Tiles captured intro frames into one contact sheet: node scripts/intro-sheet.mjs <prefix> <cols> <cellWidth>
import { chromium } from '@playwright/test';
import { readdirSync, writeFileSync } from 'node:fs';
const [prefix, cols = '4', cw = '340'] = process.argv.slice(2);
const files = readdirSync('screenshots/intro')
  .filter((f) => f.startsWith(prefix + '-'))
  .sort();
const html = `<body style="margin:0;background:#888;display:grid;grid-template-columns:repeat(${cols},${cw}px);gap:4px;padding:4px;font:11px sans-serif">${files
  .map(
    (f) =>
      `<div><img src="${f}" style="width:${cw}px;display:block"><div style="color:#fff">${f}</div></div>`,
  )
  .join('')}</body>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: Number(cols) * (Number(cw) + 4) + 4, height: 400 } });
writeFileSync('screenshots/intro/_sheet.html', html);
await p.goto(`file://${process.cwd()}/screenshots/intro/_sheet.html`);
await p.waitForTimeout(400);
await p.screenshot({ path: `screenshots/intro/sheet-${prefix}.png`, fullPage: true });
await b.close();
