// Local development only: captures actual renderer poses at 0/25/50/75/100% elapsed time.
// node scripts/capture-intro.mjs /g/LOCAL_TEST_TOKEN 390 844 phone
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const [path, w='1440', h='900', prefix='intro'] = process.argv.slice(2);
if (!path?.startsWith('/g/') || !/^[\w-]+$/.test(prefix)) throw Error('Use a local gallery path and simple output prefix');
mkdirSync('.wrangler/redesign-evidence', {recursive:true});
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:Number(w),height:Number(h)}});
 await page.addInitScript(()=>{window.__LSG_INTRO_SPEED__=0;window.__LSG_INTRO_TIME__=0;});
 await page.goto('http://localhost:5190'+path,{waitUntil:'domcontentloaded'});
 await page.waitForSelector('[data-phase="open"]');
 for(const percent of [0,25,50,75,100]) {
  await page.evaluate(t=>{window.__LSG_INTRO_TIME__=t},percent*11);
  await page.waitForTimeout(40);
  await page.screenshot({path:`.wrangler/redesign-evidence/${prefix}-${percent}.png`});
 }
 console.log('Five local frames captured; no gallery URLs printed.');
} finally { await browser.close(); }
