/* Visual project experience: cards with imagery, project page tabs, schematic site layout, gallery, uploads, client sharing, KSA map. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const B = process.env.BASE_URL || 'http://localhost:3100';
const OUT = process.env.OUT || 'test-results';
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failures++; };

(async () => {
  const b = await chromium.launch();
  const errs = [];
  async function login(who) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`${who} ${e.message}`));
    p.on('response', (r) => { if (r.status() >= 500) errs.push(`${who} ${r.status()} ${r.url()}`); });
    await p.goto(B + '/login');
    await p.locator('button', { hasText: who }).first().click();
    await p.waitForLoadState('networkidle');
    await ctx.addCookies([{ name: 'locale', value: 'en', url: B }]);
    return p;
  }
  const flash = async (p) => ((await p.locator('[role=status]').first().textContent().catch(() => '')) || '').trim();

  // 1. Project directory: every card has an image with an honest badge
  const ops = await login('Imran Qureshi');
  await ops.goto(B + '/ops/projects');
  const cards = await ops.locator('a[data-project]').count();
  check(cards === 7, `7 project cards incl. Jeddah, Makkah, Rabigh (${cards})`);
  check((await ops.locator('a[data-project] img').count()) === cards, 'every card has a hero image');
  check((await ops.locator('a[data-project]:has-text("Illustrative image")').count()) === cards, 'illustrations are badged "Illustrative image"');
  for (const city of ['Jubail', 'Jeddah', 'Makkah', 'Rabigh', 'Riyadh']) check((await ops.locator(`a[data-project]:has-text("${city}")`).count()) >= 1, `card in ${city}`);
  check((await ops.locator('a[data-project="PRJ-26-001"]:has-text("Next committed date")').count()) === 1, 'card shows next committed date, owner and awaiting customer');
  await ops.screenshot({ path: `${OUT}/project-cards.png`, fullPage: false });

  // 2. Project page: header, per-service progress with effort weights, tabs, schematic layout
  const href = await ops.locator('a[data-project="PRJ-26-006"]').getAttribute('href');
  const pid = href.split('/').pop();
  await ops.goto(B + href);
  check((await ops.locator('text=% of effort').count()) >= 2, 'service packages show % of effort (Makkah: 3 services)');
  check((await ops.locator('svg [data-area]').count()) === 4, 'schematic layout draws every area');
  for (const t of ['Service packages', 'Site areas', 'Progress photos', 'Commitments', 'Sign-offs', 'Commercial', 'Activity']) check((await ops.locator(`nav[aria-label="Project sections"] a:has-text("${t}")`).count()) === 1, `tab ${t}`);
  check((await ops.locator('text=Assigned team').count()) === 1 && (await ops.locator('text=Upcoming commitments').count()) === 1 && (await ops.locator('text=Awaiting customer decisions').count()) === 1, 'overview shows team, commitments and customer decisions');
  await ops.screenshot({ path: `${OUT}/project-detail.png`, fullPage: true });
  await ops.goto(`${B}/ops/projects/${pid}?tab=packages`);
  check((await ops.locator('text=Share of effort').count()) === 3, 'service packages tab: one card per service');

  // 3. Gallery: filters, upload a real site photo (RGS only first), it leads and becomes the cover; then share it
  await ops.goto(`${B}/ops/projects/${pid}?tab=photos`);
  const before = await ops.locator('figure[data-photo]').count();
  check(before >= 3, `gallery shows illustrations (${before})`);
  await ops.goto(`${B}/ops/projects/${pid}?tab=photos&stage=after`);
  check((await ops.locator('figure[data-photo]').count()) < before, 'stage filter narrows the gallery');
  await ops.goto(`${B}/ops/projects/${pid}?tab=photos`);
  const dir = path.join(OUT, 'tmp'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'roof.png');
  fs.writeFileSync(f, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHUlEQVR4nGP4z8BAEmIY1TCqYVTDqIZRDcNKAwDDsP8BvTBszwAAAABJRU5ErkJggg==', 'base64'));
  await ops.locator('input[name=file]').setInputFiles(f);
  await ops.locator('input[name=caption]').fill('Tower A roof, PU membrane second coat (north side)');
  await ops.locator('select[name=stage]').selectOption('during');
  await ops.locator('input[name=visible]').uncheck();
  await ops.locator('input[name=cover]').check();
  await ops.locator('button:has-text("Upload photo")').click();
  await ops.waitForURL(/msg=/);
  check(/Photo added.*RGS only/.test(await flash(ops)), `site photo uploaded, RGS only (${await flash(ops)})`);
  check((await ops.locator('figure[data-photo]').first().getAttribute('data-photo')) === 'photo', 'real photos are shown first');
  check((await ops.locator('figure[data-photo="photo"]:has-text("Site photo")').count()) === 1, 'real photo badged "Site photo"');
  await ops.goto(B + '/ops/projects');
  check((await ops.locator('a[data-project="PRJ-26-006"]:has-text("Site photo")').count()) === 1, 'uploaded photo becomes the project cover');

  // 4. Client sees only shared photos; after sharing, they see it
  const mk = await login('Abdulrahman Al-Hindi');
  await mk.goto(B + '/client/projects');
  check((await mk.locator('a[data-project]').count()) === 1, 'Makkah client sees only their project');
  await mk.goto(`${B}/client/projects/${pid}?tab=photos`);
  check((await mk.locator('figure[data-photo="photo"]').count()) === 0, 'unshared site photo hidden from the client');
  await ops.goto(`${B}/ops/projects/${pid}?tab=photos`);
  await ops.locator('figure[data-photo="photo"] button:has-text("Share with client")').click();
  await ops.waitForURL(/msg=/);
  await mk.goto(`${B}/client/projects/${pid}?tab=photos`);
  check((await mk.locator('figure[data-photo="photo"]').count()) === 1, 'shared photo visible to the client');
  const src = await mk.locator('figure[data-photo="photo"] img').getAttribute('src');
  check((await mk.request.get(B + src)).status() === 200, 'client can load the shared photo');
  const other = await login('Saad Al-Otaibi');
  check((await other.request.get(B + src)).status() === 404, "another client cannot load Makkah's photo");
  check((await other.goto(`${B}/client/projects/${pid}`)).status() === 404, "another client cannot open Makkah's project");
  await mk.screenshot({ path: `${OUT}/client-gallery.png`, fullPage: false });

  // 5. Map: pins per city; clicking Makkah lists its project
  await ops.goto(B + '/ops/map');
  for (const city of ['Jeddah', 'Makkah', 'Rabigh', 'Jubail', 'Riyadh', 'Khobar']) check((await ops.locator(`[data-pin="${city}"]`).count()) === 1, `map pin ${city}`);
  await ops.locator('[data-pin="Makkah"] circle').nth(1).click();
  await ops.waitForURL(/city=Makkah/);
  check((await ops.locator('[data-map-project]').count()) === 1 && (await ops.locator('[data-map-project="PRJ-26-006"]').count()) === 1, 'Makkah lists Al Aziziyah Hotel Towers');
  await ops.screenshot({ path: `${OUT}/projects-map.png`, fullPage: false });
  await mk.goto(B + '/client/map');
  check((await mk.locator('[data-pin]').count()) === 1, 'client map shows only their own sites');

  // 6. Arabic
  const ar = await login('Mohammed Al-Dossary');
  await ar.context().addCookies([{ name: 'locale', value: 'ar', url: B }]);
  await ar.goto(B + '/client/projects');
  check((await ar.locator('text=صورة توضيحية').count()) >= 1, 'Arabic badge on illustrations');

  await b.close();
  if (errs.length) { console.log('ERRORS [', errs.join('\n'), ']'); failures++; }
  console.log(failures ? `${failures} failure(s)` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
