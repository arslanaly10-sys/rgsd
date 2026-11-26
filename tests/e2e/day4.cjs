const { chromium, devices } = require('playwright');
const B = 'http://localhost:3100', SP = (process.env.OUT || 'test-results');
(async () => {
  const b = await chromium.launch();
  const errs = [];
  // A real image to upload: screenshot of a coloured page, saved with a telling file name (mock AI reads names).
  const tmp = await b.newPage(); await tmp.setContent('<div style="width:400px;height:300px;background:linear-gradient(#888,#333)"></div>');
  await tmp.screenshot({ path: SP + '/missing-guardrail.png' }); await tmp.close();
  async function login(who, mobile = false) {
    const ctx = await b.newContext(mobile ? { ...devices['Pixel 7'] } : { viewport: { width: 1400, height: 1000 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(who + ' ' + e.message));
    p.on('response', r => { if (r.status() >= 500) errs.push(`${who} ${r.status()} ${r.url()}`); });
    await p.goto(B + '/login');
    await p.locator('button', { hasText: who }).first().click();
    await p.waitForLoadState('networkidle');
    return { ctx, p };
  }
  // 1. Inspector, online, with AI photo check
  const { ctx: ictx, p: ins } = await login('Arjun Nair', true);
  await ins.goto(B + '/field');
  const firstTag = (await ins.locator('a[href^="/field/inspect/"]').first().getAttribute('href')).split('/').pop();
  await ins.goto(B + '/field/inspect/' + firstTag);
  console.log('inspecting', firstTag);
  await ins.locator('li', { hasText: 'TOE' }).getByRole('radio', { name: 'Fail' }).click();
  await ins.setInputFiles('input[type=file]', SP + '/missing-guardrail.png');
  await ins.click('text=Check photos with AI');
  await ins.waitForSelector('text=AI (', { timeout: 20000 }).catch(() => {});
  console.log('suggestion:', (await ins.locator('text=Evidence suggests').textContent()).trim());
  await ins.getByRole('button', { name: /^Yellow/ }).click();
  console.log('override box shown:', await ins.locator('#override').isVisible());
  await ins.getByRole('button', { name: /^Red/ }).click();
  await ins.check('input[type=checkbox]');
  await ins.screenshot({ path: SP + '/shots/field_inspect.png', fullPage: false });
  await ins.click('button:has-text("Sign and submit")');
  console.log('online submit:', (await ins.locator('[role=status]').textContent({ timeout: 20000 })).trim());
  // 2. Offline inspection of the second scaffold, then sync
  await ins.goto(B + '/field');
  const second = (await ins.locator('a[href^="/field/inspect/"]').nth(1).getAttribute('href')).split('/').pop();
  await ins.goto(B + '/field/inspect/' + second);
  await ictx.setOffline(true);
  await ins.evaluate(() => window.dispatchEvent(new Event('offline')));
  await ins.check('input[type=checkbox]');
  await ins.click('button:has-text("Sign and submit")');
  console.log('offline submit:', second, (await ins.locator('[role=status]').textContent()).trim());
  await ictx.setOffline(false);
  await ins.goto(B + '/field');
  await ins.waitForSelector('[data-testid=outbox-empty]', { timeout: 15000 }).catch(() => {});
  console.log('after reconnect:', (await ins.locator('[data-testid=outbox], [data-testid=outbox-empty]').first().textContent()).trim());
  await ins.screenshot({ path: SP + '/shots/field_list.png' });
  // 3. Supervisor tries to tag green via the API
  const { p: sup } = await login('Joseph Mathew');
  const r = await sup.request.post(B + '/api/field/inspections', { data: { offline_id: 'test-sup-0001', tag_no: firstTag, type: 'ad_hoc', checklist: [{ code: 'FND', result: 'pass' }], result: 'green', competent_person_confirmed: true, photos: [] } });
  console.log('supervisor green:', r.status(), (await r.json()).error);
  // 4. Watcher
  const { p: ops } = await login('Imran Qureshi');
  await ops.goto(B + '/ops/tasks');
  await Promise.all([ops.waitForURL(/msg=/), ops.click('button:has-text("Run compliance watcher now")')]);
  console.log('watcher:', (await ops.locator('[role=status]').textContent()).trim());
  await ops.goto(B + '/ops/scaffolds/' + firstTag);
  await ops.screenshot({ path: SP + '/shots/scaffold_detail.png', fullPage: true });
  await ops.goto(B + `/tags/${firstTag}`);
  await ops.screenshot({ path: SP + '/shots/tag_label.png' });
  // 5. Client visibility
  const { p: cl } = await login('Elena Petrova');
  const own = await cl.goto(B + '/client/scaffolds/SDR-0021'); console.log('client own scaffold:', own.status());
  const other = await cl.goto(B + '/client/scaffolds/' + firstTag); console.log('client other client scaffold', firstTag, ':', other.status());
  const photoId = await ops.evaluate(() => [...document.querySelectorAll('img[src^="/api/files/"]')].map(i => i.getAttribute('src'))[0]).catch(() => null);
  const ph = await ops.goto(B + `/ops/scaffolds/${firstTag}`).then(() => ops.locator('img[src^="/api/files/"]').first().getAttribute('src'));
  console.log('staff photo:', (await ops.request.get(B + ph)).status(), ' client photo of other client:', (await cl.request.get(B + ph)).status());
  console.log('ERRORS', errs.length ? errs : 'none');
  await b.close();
})();
