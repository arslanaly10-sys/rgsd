const { chromium } = require('playwright');
const out = (process.env.OUT || 'test-results');
(async () => {
  const b = await chromium.launch();
  const errs = [];
  async function as(label, who, paths, opts = {}) {
    const ctx = await b.newContext({ viewport: opts.vp || { width: 1400, height: 900 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(`${label} pageerror ${e.message}`));
    p.on('response', r => { if (r.status() >= 500) errs.push(`${label} ${r.status()} ${r.url()}`); });
    await p.goto('http://localhost:3100/login');
    if (opts.ar) { await p.click('text=العربية'); await p.waitForFunction(() => document.documentElement.dir === 'rtl'); }
    await p.locator('button', { hasText: who }).first().click();
    await p.waitForLoadState('networkidle');
    for (const path of paths) {
      await p.goto('http://localhost:3100' + path, { waitUntil: 'networkidle' });
      const h1 = await p.locator('h1').first().textContent().catch(() => '?');
      console.log(label, path, '→', p.url().replace('http://localhost:3100', ''), '|', h1?.trim());
      await p.screenshot({ path: `${out}/${label}${path.replace(/\//g, '_')}.png`, fullPage: false });
    }
    await ctx.close();
  }
  await as('ops', 'Imran Qureshi', ['/ops', '/ops/scaffolds', '/ops/requests', '/ops/fleet', '/ops/workforce', '/ops/billing', '/ops/sites', '/ops/approvals', '/ops/agents', '/field', '/client']);
  await as('client', 'Elena Petrova', ['/client', '/client/scaffolds', '/client/requests', '/client/billing', '/ops']);
  await as('ar', 'عمران', ['/ops', '/ops/scaffolds'], { ar: true });
  await as('mobile', 'Arjun Nair', ['/field', '/ops'], { vp: { width: 390, height: 844 } });
  console.log('ERRORS', errs.length ? errs : 'none');
  await b.close();
})();
