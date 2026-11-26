/* Phase C: progress claims with retention and advance recovery, credit notes, payments and statement of account, support tickets with SLA, workforce competency. */
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
    const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`${who} ${e.message}`));
    p.on('response', (r) => { if (r.status() >= 500) errs.push(`${who} ${r.status()} ${r.url()}`); });
    await p.goto(B + '/login');
    await p.locator('button', { hasText: who }).first().click();
    await p.waitForLoadState('networkidle');
    await ctx.addCookies([{ name: 'locale', value: 'en', url: B }]); // run in English regardless of the user's preference
    return p;
  }
  const act = async (p, loc, re = /msg=/) => { const before = p.url(); await Promise.all([p.waitForURL((u) => u.toString() !== before && re.test(decodeURIComponent(u.toString())), { timeout: 60000 }), (typeof loc === 'string' ? p.locator(loc).first() : loc).click()]); await p.waitForLoadState('networkidle'); };
  const flash = async (p) => ((await p.locator('[role=status]').first().textContent().catch(() => '')) || '').trim();
  const ask = async (p, text) => (await (await p.request.post(B + '/api/copilot', { data: { text, locale: 'en' } })).json());

  // 1. New sections render for staff and clients
  const ops = await login('Imran Qureshi');
  const fin = await login('Huda Al-Shehri');
  const faris = await login('Faris Al-Ghamdi');
  for (const sec of ['claims', 'credit-notes', 'statement', 'support', 'contacts', 'workforce']) check((await ops.goto(`${B}/ops/${sec}`)).status() === 200, `staff /ops/${sec}`);
  for (const sec of ['claims', 'statement', 'support', 'help', 'contacts']) check((await faris.goto(`${B}/client/${sec}`)).status() === 200, `client /client/${sec}`);
  check((await faris.goto(`${B}/ops/claims`)).url().includes('/login') || !(await faris.content()).includes('Submit claim'), 'client cannot open staff claims');

  // 2. Client signs the November measurement, finance submits a progress claim, client PM and procurement certify it, a progress invoice is drafted
  const omar = await login('Omar Saeed');
  for (const [who, p] of [['Faris Al-Ghamdi', faris], ['Omar Saeed', omar]]) {
    await p.goto(B + '/client/signoffs');
    const ms = p.locator('section', { hasText: 'MS-26-0012' }).filter({ has: p.locator('input[name=signature]') }).first();
    await ms.locator('input[name=signature]').fill(who);
    await act(p, ms.locator('button[value=approved]'));
  }
  check(/approved|certified|quantities/i.test(await flash(omar)), `November measurement signed (${await flash(omar)})`);
  await fin.goto(B + '/ops/claims');
  await fin.screenshot({ path: `${OUT}/claims.png`, fullPage: true });
  const sec = fin.locator('section', { hasText: 'PRJ-26-001' }).filter({ has: fin.locator('button:has-text("Submit claim")') }).first();
  const enabled = await sec.locator('button:has-text("Submit claim")').isEnabled();
  check(enabled, 'PRJ-26-001 has new certified work to claim');
  let claimRef = null;
  if (enabled) {
    await act(fin, sec.locator('button:has-text("Submit claim")'));
    const m = await flash(fin);
    claimRef = (m.match(/PC-26-\d{4}/) || [])[0];
    check(!!claimRef && /sent to the client to certify/.test(m), `claim submitted (${m})`);
  }
  const layla = await login('Layla Hamdan');
  for (const [who, p] of [['Faris Al-Ghamdi', faris], ['Layla Hamdan', layla]]) {
    await p.goto(B + '/client/signoffs');
    const so = p.locator('section', { hasText: claimRef || 'Payment claim' }).filter({ has: p.locator('input[name=signature]') }).first();
    if (!(await so.count())) { check(false, `${who} sees the claim to certify`); continue; }
    await so.locator('input[name=signature]').fill(who);
    await act(p, so.locator('button[value=approved]'));
    check(/./.test(await flash(p)), `${who} certifies ${claimRef} (${await flash(p)})`);
  }
  check(/Claim certified\. RGS will issue invoice INV-/.test(await flash(layla)), 'second signature certifies the claim and drafts the invoice');
  await fin.goto(B + '/ops/claims');
  const row = fin.locator('tr', { hasText: claimRef || 'zzz' });
  check(/Certified|Invoiced/.test(await row.textContent().catch(() => '')) && /INV-/.test(await row.textContent().catch(() => '')), 'claim shows certified with its invoice');
  await faris.goto(B + '/client/claims');
  check((await faris.locator('text=PC-26-0001').count()) === 0, 'Bargash client cannot see Sadara claim PC-26-0001');
  check((await faris.locator(`text=${claimRef}`).count()) > 0, 'client sees their claim');
  await faris.screenshot({ path: `${OUT}/client-claims.png`, fullPage: true });

  // 3. Credit note: draft hidden from client, finance submits, admin approves, issued and on the statement
  const nora = await login('Nora Al-Harbi');
  await nora.goto(B + '/client/statement');
  check((await nora.locator('text=CN-26-001').count()) === 0, 'draft credit note is not visible to the client');
  await fin.goto(B + '/ops/credit-notes');
  await act(fin, fin.locator('tr', { hasText: 'CN-26-001' }).locator('button:has-text("Submit for approval")'));
  check(/sent to Finance for approval/.test(await flash(fin)), `CN-26-001 submitted (${await flash(fin)})`);
  const admin = await login('Khalid Al-Mutairi');
  await admin.goto(B + '/ops/approvals');
  const ap = admin.locator('section', { hasText: 'issue_credit_note' }).filter({ has: admin.locator('button[value=approved]') }).first();
  await act(admin, ap.locator('button[value=approved]'));
  await fin.goto(B + '/ops/credit-notes');
  check(/issued/.test(await fin.locator('tr', { hasText: 'CN-26-001' }).textContent()), 'CN-26-001 issued after approval');
  await nora.goto(B + '/client/statement');
  check((await nora.locator('text=CN-26-001').count()) > 0, 'issued credit note appears on the client statement');

  // 4. Statement and ageing: Qiddiya claim invoice is overdue; finance records part payment
  check(/overdue/.test(await nora.locator('main').textContent()), 'Qiddiya statement shows an overdue invoice');
  await nora.screenshot({ path: `${OUT}/statement.png`, fullPage: true });
  await fin.goto(B + '/ops/statement');
  const before = await fin.locator('text=Total outstanding').locator('..').textContent();
  await fin.locator('form:has(button:has-text("Record payment")) input[name=amount]').fill('10000');
  await fin.locator('form:has(button:has-text("Record payment")) input[name=reference]').fill('SNB-TT-88213');
  await act(fin, 'button:has-text("Record payment")');
  check(/Payment of SAR 10,000 recorded/.test(await flash(fin)), 'payment recorded');
  check((await fin.locator('text=SNB-TT-88213').count()) > 0 && before !== await fin.locator('text=Total outstanding').locator('..').textContent(), 'payment shows in the ledger and reduces outstanding');
  const ops2 = await login('Joseph Mathew');
  await ops2.goto(B + '/ops/statement');
  check((await ops2.locator('button:has-text("Record payment")').count()) === 0, 'non-finance staff cannot record payments');

  // 5. Support: client opens a ticket, RGS replies with an internal note and resolves, client closes and rates
  const saad = await login('Saad Al-Otaibi');
  await saad.goto(B + '/client/support');
  await saad.locator('select[name=category]').selectOption('warranty_claim');
  await saad.locator('input[name=subject]').fill('Leak at expansion joint');
  await saad.locator('textarea[name=body]').fill('Water seen at the B2 expansion joint after rain.');
  await act(saad, 'button:has-text("Open ticket")');
  check(/Pick the warranty/.test(await flash(saad)), 'warranty claim without a warranty is refused');
  await saad.locator('select[name=category]').selectOption('defect');
  await saad.locator('select[name=priority]').selectOption('urgent');
  await saad.locator('input[name=subject]').fill('Water ingress at B2 expansion joint');
  await saad.locator('textarea[name=body]').fill('Water seen at the B2 expansion joint grid 9 after rain this morning.');
  await act(saad, 'button:has-text("Open ticket")');
  const tk = (await flash(saad)).match(/TK-26-\d{4}/)?.[0];
  check(!!tk && /(within 2 h|خلال 2 ساعة)/.test(await flash(saad)), `urgent ticket opened with a 2 h response target (${await flash(saad)})`);
  const ticketUrl = saad.url().split('?')[0];
  const tid = ticketUrl.split('/').pop();
  await ops.goto(`${B}/ops/support/${tid}`);
  await ops.locator('textarea[name=body]').fill('Check whether the dewatering pump tripped again.');
  await ops.locator('input[name=internal]').check();
  await act(ops, 'button:has-text("Send")');
  await ops.locator('textarea[name=body]').fill('Our team sealed the joint with PU injection; please confirm it is dry tomorrow.');
  await ops.locator('select[name=status]').selectOption('resolved');
  await act(ops, 'button:has-text("Send")');
  check(/resolved/.test(await flash(ops)), 'RGS resolves the ticket');
  await saad.goto(ticketUrl);
  check((await saad.locator('text=dewatering pump tripped').count()) === 0, 'internal note hidden from the client');
  check((await saad.locator('text=PU injection').count()) > 0, 'client sees the RGS reply');
  await saad.locator('select[name=satisfaction]').selectOption('4');
  await act(saad, 'button:has-text("Close ticket")');
  check(/closed, rated 4\/5/.test(await flash(saad)), 'client closes and rates the ticket');
  await saad.screenshot({ path: `${OUT}/ticket.png`, fullPage: true });
  check((await (await faris.goto(`${B}/client/support/${tid}`)).text()).includes('Ticket not found') || (await faris.locator('text=Water ingress').count()) === 0, 'another client cannot open the ticket');

  // 6. Workforce: competency blocks an unqualified worker; certificate upload + HSE verify
  await ops.goto(B + '/ops/workforce');
  await ops.screenshot({ path: `${OUT}/workforce.png`, fullPage: true });
  await ops.locator('select[name=siteCode]').selectOption('KRN');
  await ops.locator('input[name=employeeNos]').fill('RGS-2008');
  await act(ops, 'button:has-text("Check & assign")');
  check(/Refused: RGS-2008.*bosiet/i.test(await flash(ops)), `RGS-2008 refused for offshore KRN (${await flash(ops)})`);
  const hse = await login('Nasser Al-Qahtani');
  await hse.goto(B + '/ops/workforce');
  const dir = path.join(OUT, 'tmp'); fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, 'BOSIET_RGS-2008_2028-03-01.jpg');
  fs.writeFileSync(f, Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64'));
  await hse.locator('input[name=file]').setInputFiles(f);
  await act(hse, 'button:has-text("Read & record")');
  check(/opito bosiet for .* recorded, expiring 2028-03-01/i.test(await flash(hse)), `certificate read from upload (${await flash(hse)})`);
  await act(hse, hse.locator('tr', { hasText: 'RGS-2008' }).locator('button:has-text("Verify original")').first());
  check(/verified/.test(await flash(hse)), 'HSE verifies the certificate');

  // 7. Copilot
  let j = await ask(nora, "What's our statement balance and ageing?");
  check(j.agent === 'concierge' && /Outstanding SAR/.test(j.reply || ''), `client asks statement → statement_summary (${(j.reply || '').slice(0, 80)})`);
  j = await ask(faris, 'What is the status of our claims?');
  check(/PRJ-26-001: \d claim/.test(j.reply || '') && !/PRJ-26-003/.test(j.reply || ''), 'client claim status only shows their project');
  j = await ask(saad, 'Please open a ticket about a leak in the tank room, urgent');
  check(/Ticket TK-26-\d{4} opened/.test(j.reply || ''), `client opens a ticket via copilot (${(j.reply || '').slice(0, 80)})`);
  j = await ask(ops, 'Who at KRN is not competent to work offshore?');
  check(j.agent === 'workforce' && /checked for KRN/.test(j.reply || ''), `competency check via copilot (${(j.reply || '').slice(0, 100)})`);
  j = await ask(fin, 'Show claim status and retention for PRJ-26-002');
  check(j.agent === 'finance' && /PRJ-26-002/.test(j.reply || ''), 'finance agent answers claim status');

  // 8. Watchers include the support SLA check
  await ops.goto(B + '/ops/tasks');
  await act(ops, 'button:has-text("Run")');
  check(/Support: \d+ ticket\(s\) escalated/.test(await flash(ops)), `support SLA watcher runs (${(await flash(ops)).slice(-60)})`);

  await b.close();
  if (errs.length) { console.log('ERRORS [', errs.join('\n'), ']'); failures++; }
  console.log(failures ? `${failures} failure(s)` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
