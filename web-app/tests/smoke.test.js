// Smoke test for dist/index.html. Needs Playwright: npm i -D playwright && npx playwright install chromium
// Run: node tests/smoke.test.js   (after node build.mjs)
const { chromium } = require('playwright');
const path = require('path');
const assert = require('assert');
const page = 'file://' + path.resolve(__dirname, '../dist/index.html');
const sample = (f) => path.resolve(__dirname, '../samples', f);
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  // Selects are hidden behind the custom dropdown: open its button, then click the option with the same label.
  const choose = async (selector, value) => { const sel = await p.$(selector); const label = await sel.evaluate((s, v) => [...s.options].find((o) => o.value === v).textContent, value);
    await sel.evaluate((s) => s.previousElementSibling.click()); await p.click(`.pk-pop .pk-opt > span:text-is("${label}")`); };
  await p.goto(page); await p.waitForTimeout(400);
  if (await p.$('.sp-go')) { await p.click('.sp-go'); await p.waitForTimeout(400); }
  await p.click('.who button:has-text("Mom")'); await p.waitForTimeout(300); if (await p.$('.sp-go')) { await p.click('.sp-go'); await p.waitForTimeout(400); }
  // 1. import the sample file for Ben: Due date = day the task is done
  await p.click('#hdr >> text="Import"'); await choose('#main select', 'ben');
  await p.setInputFiles('input[type=file]', sample('bai-tap-mau.xlsx')); await p.waitForTimeout(800);
  await p.click('button:has-text("Save all")'); await p.waitForTimeout(300);
  const tasks = await p.evaluate(() => JSON.parse(localStorage.getItem('study-planner-wc-v3')).tasks);
  assert.strictEqual(tasks.filter((k) => k.child === 'ben').length, 6, 'six tasks imported');
  tasks.forEach((k) => assert.strictEqual(k.date, k.due, 'Due date is the work day'));
  assert.ok(tasks.some((k) => k.teacher === 'Cô Linh Cindy' && k.subject === 'English'));
  assert.ok(tasks.some((k) => (k.links || []).length === 1));
  // 2. a task for Mom
  await p.click('#hdr >> text="Today"'); await p.click('button:has-text("Add task") >> nth=0');
  await p.fill('.modal input:not([type]) >> nth=0', 'Print next week worksheets'); await choose('.modal select >> nth=2', 'mom');
  await p.click('.modal button:has-text("Add task")'); await p.waitForTimeout(300);
  assert.ok(await p.$('.s-mom'), "Mom's section shows");
  // 3. attach a PDF and see a Print link
  await p.click('.s-mom .task2 button[title="Attach files"]'); await p.setInputFiles('.modal input[type=file]', sample('phieu-mau.pdf')); await p.waitForTimeout(500);
  await p.click('.modal button:has-text("Close")'); await p.waitForTimeout(300);
  assert.ok(await p.$('.s-mom .fchips a:has-text("Print")'), 'Print link on the file');
  // 4. study sheet has the three sections
  await choose('#main .toolbar select', 'ben'); await p.click('button:has-text("Print sheet")'); await p.waitForTimeout(300);
  const sheet = await p.innerText('.sheet'); ['OVERDUE', 'DUE', 'DAILY TASKS'].forEach((s) => assert.ok(sheet.includes(s), s));
  assert.deepStrictEqual(errs, [], 'no page errors');
  console.log('smoke test passed'); await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
