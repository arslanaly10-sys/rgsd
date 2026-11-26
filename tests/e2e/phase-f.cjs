/* Client overview like the prototype: role chips, what you can act on, awaiting your organisation, commitments, changes since last visit, evidence-linked attention; view-only role; global search; project switcher; client evidence upload. */
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

  // 1. Viewer: sees everything, can act on nothing
  const reem = await login('Reem Al-Saleh');
  await reem.goto(B + '/client');
  check((await reem.locator('text=Your projects at a glance').count()) === 1, 'overview headline');
  check((await reem.locator('[data-chips] >> text=Customer viewer').count()) === 1, 'role chip: Customer viewer');
  check((await reem.locator('[data-can-act]').getAttribute('data-can-act')) === '0', 'viewer can act on 0');
  check((await reem.locator('[aria-disabled=true]:has-text("Raise a request")').count()) === 1 && (await reem.locator('text=Your role is view-only').count()) >= 2, 'quick actions disabled with explanation');
  const views = await reem.locator('[data-pending=view]').count();
  check(views >= 3 && (await reem.locator('[data-pending=act]').count()) === 0, `awaiting your organisation: ${views} items, all "Not available"`);
  check((await reem.locator('text=Your role can view this but cannot act on it.').count()) === views, 'each item explains why');
  check((await reem.locator('a:has-text("Contact your RGS representative")').count()) === 1, 'contact RGS representative');
  await reem.screenshot({ path: `${OUT}/client-overview-viewer.png`, fullPage: true });
  await reem.goto(B + '/client/requests');
  check((await reem.locator('form:has(button:has-text("Send request"))').count()) === 0, 'viewer has no request form');
  await reem.goto(B + '/client/projects');
  const pid = (await reem.locator('a[data-project]').first().getAttribute('href')).split('/').pop();
  await reem.goto(`${B}/client/projects/${pid}?tab=photos`);
  check((await reem.locator('#upload').count()) === 0, 'viewer cannot upload evidence');
  let j = await (await reem.request.post(B + '/api/copilot', { data: { text: 'Please open a ticket about a roof leak', locale: 'en' } })).json();
  check(!(j.steps || []).some((s) => s.name === 'open_ticket' && s.status === 'ok'), 'copilot will not open a ticket for a viewer');
  j = await (await reem.request.post(B + '/api/copilot', { data: { text: 'What is the status of our projects?', locale: 'en' } })).json();
  check((j.steps || []).some((s) => s.name === 'project_status' && s.status === 'ok'), 'viewer can still ask read-only questions');

  // 2. Approver (client PM): can act; links lead to the record
  const faris = await login('Faris Al-Ghamdi');
  await faris.goto(B + '/client');
  const can = Number(await faris.locator('[data-can-act]').getAttribute('data-can-act'));
  check(can >= 2, `client PM can act on ${can}`);
  check((await faris.locator('[data-pending=act] a:has-text("Review and sign")').count()) >= 1, '"Review and sign" on items the PM can sign');
  check((await faris.locator('[data-pending=view]').count()) >= 1, 'items only the consultant can sign show "Not available" to the PM');
  check(Number(await faris.locator('[data-changes]').getAttribute('data-changes')) > 0, 'changes since last visit counted');
  const ev = await faris.locator('text=Evidence: >> xpath=.. >> a').first().getAttribute('href');
  check((await faris.request.get(B + ev)).status() === 200, `attention evidence link opens (${ev})`);
  await faris.locator('[data-pending=act] a:has-text("Review and sign")').first().click();
  await faris.waitForURL(/signoffs/);
  check(/\/client\/signoffs/.test(faris.url()), 'Review and sign goes to the sign-off');
  await faris.goto(B + '/client');
  if (await faris.locator('[data-pending=act] a:text-is("Review")').count()) {
    await faris.locator('[data-pending=act] a:text-is("Review")').first().click();
    await faris.waitForURL(/docreview/);
    check(true, 'document items open Document reviews');
  }
  await faris.goto(B + '/client');
  await faris.screenshot({ path: `${OUT}/client-overview-approver.png`, fullPage: true });

  // 3. Client requester uploads evidence; it appears as a client photo
  await faris.goto(`${B}/client/projects/${pid}?tab=photos`);
  const dir = path.join(OUT, 'tmp'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'leak.png');
  fs.writeFileSync(f, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAHUlEQVR4nGP4z8BAEmIY1TCqYVTDqIZRDcNKAwDDsP8BvTBszwAAAABJRU5ErkJggg==', 'base64'));
  await faris.locator('#upload input[name=file]').setInputFiles(f);
  await faris.locator('#upload input[name=caption]').fill('Damp patch at podium drain, grid D4');
  await faris.locator('#upload button:has-text("Upload photo")').click();
  await faris.waitForURL(/msg=/);
  check(/Photo added/.test(await flash(faris)), 'client uploads evidence');
  check((await faris.locator('figure[data-photo=photo]:has-text("Client photo")').count()) === 1, 'shown as a client photo with name');
  const ops = await login('Imran Qureshi');
  await ops.goto(`${B}/ops/projects/${pid}?tab=photos`);
  check((await ops.locator('figure[data-photo=photo]:has-text("Damp patch")').count()) === 1, 'RGS sees the client evidence');

  // 4. Search and project switcher, under RLS
  await faris.goto(B + '/client/search?q=flood');
  check((await faris.locator('[data-hit]').count()) >= 1, 'client search finds flood-test items');
  await faris.goto(B + '/client/search?q=Sadara');
  check((await faris.locator('[data-hit=Project]').count()) === 0, "client search never shows another client's project");
  await ops.goto(B + '/ops/search?q=PRJ-26-006');
  check((await ops.locator('[data-hit=Project]').count()) === 1, 'staff search finds a project by ref');
  await ops.locator('[data-hit=Project]').first().click();
  await ops.waitForURL(/\/ops\/projects\//);
  check(true, 'search result opens the project');
  await ops.goto(B + '/ops');
  await ops.locator('[data-project-switcher] summary').click();
  check((await ops.locator('[data-project-switcher] a').count()) === 8, 'project switcher lists all projects');
  await ops.locator('[data-project-switcher] a:has-text("PRJ-26-007")').click();
  await ops.waitForURL(/\/ops\/projects\//);
  check((await ops.locator('h1:has-text("Rabigh")').count()) === 1, 'switcher opens Rabigh');
  await faris.goto(B + '/client');
  await faris.locator('[data-project-switcher] summary').click();
  check((await faris.locator('[data-project-switcher] a').count()) === 2, 'client switcher shows only their project');
  check((await faris.locator('[data-client-badge]').count()) >= 1, 'client sidebar shows the client badge');

  await b.close();
  if (errs.length) { console.log('ERRORS [', errs.join('\n'), ']'); failures++; }
  console.log(failures ? `${failures} failure(s)` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
