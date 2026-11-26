/* Phase B: ITP tests and hold points, findings and CAPA, document reviews, evidence, HSE, handover and warranties. */
const { chromium } = require('playwright');
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
    return p;
  }
  const act = async (p, loc, re = /msg=/) => { const before = p.url(); await Promise.all([p.waitForURL((u) => u.toString() !== before && re.test(decodeURIComponent(u.toString())), { timeout: 60000 }), (typeof loc === 'string' ? p.locator(loc).first() : loc).click()]); await p.waitForLoadState('networkidle'); };
  const flash = async (p) => ((await p.locator('[role=status]').first().textContent().catch(() => '')) || '').trim();

  // 1. Every new section renders
  const ops = await login('Imran Qureshi');
  const faris = await login('Faris Al-Ghamdi');
  for (const sec of ['inspections', 'findings', 'corrective', 'checklists', 'hse', 'documents', 'evidence', 'docreview', 'handover']) {
    check((await ops.goto(`${B}/ops/${sec}`)).status() === 200, `staff /ops/${sec}`);
    check((await faris.goto(`${B}/client/${sec}`)).status() === 200, `client /client/${sec}`);
  }
  await ops.goto(B + '/ops/hse'); await ops.screenshot({ path: `${OUT}/hse.png`, fullPage: true });

  // 2. ITP: a failing DFT test raises an NCR; a passing thickness test passes
  const insp = await login('Arjun Nair');
  await insp.goto(B + '/ops/inspections');
  const dft = insp.locator('li', { hasText: 'Dry film thickness' }).filter({ has: insp.locator('input[name=readings]') }).first();
  await dft.locator('input[name=readings]').fill('2.1, 1.8, 2.2');
  await act(insp, dft.locator('button:has-text("Record")'));
  const failMsg = await flash(insp);
  check(/failed\. NCR-26-\d{3} raised/.test(failMsg), `DFT 1.8 mm fails and raises an NCR (${failMsg})`);
  const ncrRef = (failMsg.match(/NCR-26-\d{3}/) || [])[0];
  const thick = insp.locator('li', { hasText: 'Insulation thickness' }).filter({ has: insp.locator('input[name=readings]') }).first();
  await thick.locator('input[name=readings]').fill('52, 55, 51');
  await act(insp, thick.locator('button:has-text("Record")'));
  check(/passed/.test(await flash(insp)), 'insulation thickness 51–55 mm passes');
  await insp.screenshot({ path: `${OUT}/itp.png`, fullPage: false });

  // 3. Consultant releases the roof flood-test hold point → area advances, milestone achieved
  const omar = await login('Omar Saeed');
  await omar.goto(B + '/client/signoffs');
  const hold = omar.locator('section', { hasText: 'flood test, main roof' }).filter({ has: omar.locator('input[name=signature]') }).first();
  await hold.locator('input[name=signature]').fill('Omar Saeed');
  await act(omar, hold.locator('button[value=approved]'));
  const holdMsg = await flash(omar);
  check(/Hold point released.*protection/i.test(holdMsg), `roof flood test released → protection (${holdMsg})`);

  // 4. CAPA: RGS plans and verifies the new NCR, the client closes it
  await ops.goto(B + '/ops/corrective');
  const card = ops.locator('section', { hasText: ncrRef }).first();
  await card.locator('textarea[name=root_cause]').fill('Mixing ratio wrong in the afternoon heat; no wet-film checks on the podium edge.');
  await card.locator('textarea[name=corrective_action]').fill('Additional coat to the affected bay; wet-film gauge every 10 m².');
  await act(ops, card.locator('button:has-text("Save plan")'));
  check(/corrective action planned/.test(await flash(ops)), `${ncrRef} action planned`);
  const card2 = ops.locator('section', { hasText: ncrRef }).first();
  await card2.locator('input[name=note]').fill('Re-coated; DFT 2.2–2.4 mm');
  await act(ops, card2.locator('button:has-text("send to client to close")'));
  check(/sent to the client to close/.test(await flash(ops)), `${ncrRef} sent to the client`);
  await faris.goto(B + '/client/corrective');
  await act(faris, faris.locator('section', { hasText: ncrRef }).first().locator('button[value=close]'));
  check(/closed/.test(await flash(faris)), `client closes ${ncrRef}`);
  // Qiddiya PMC sends NCR-26-001 back
  const peter = await login('Peter Walsh');
  await peter.goto(B + '/client/corrective');
  const q = peter.locator('section', { hasText: 'NCR-26-001' }).first();
  await q.locator('input[name=note]').fill('Re-test the full bay, not only grid C4.');
  await act(peter, q.locator('button[value=reopen]'));
  check(/sent back/.test(await flash(peter)), 'PMC sends NCR-26-001 back to RGS');

  // 5. Client raises an observation
  await faris.goto(B + '/client/findings');
  await faris.fill('input[name=title]', 'Ponding water near roof drain D-3 after rain');
  await act(faris, 'form:has(input[name=title]) button[type=submit]');
  check(/NCR-26-\d{3}/.test(await flash(faris)), 'client raises an observation');

  // 6. Document reviews: B without a comment is refused; B with comment; submit a draft; A
  await omar.goto(B + '/client/docreview');
  const sd = omar.locator('section', { hasText: 'RGS-BRG-SD-003' }).first();
  await act(omar, sd.locator('button[value=B]'));
  check(/need at least one comment/.test(await flash(omar)), 'code B without comments is refused');
  const sd2 = omar.locator('section', { hasText: 'RGS-BRG-SD-003' }).first();
  await sd2.locator('textarea[name=comments]').fill('Show sealant joint at AHU plinth corners on detail 4.');
  await act(omar, sd2.locator('button[value=B]'));
  check(/code B/.test(await flash(omar)), 'consultant codes SD-003 rev 1 as B');
  const rania = await login('Rania Haddad');
  await rania.goto(B + '/ops/documents');
  const tr = rania.locator('section', { hasText: 'RGS-BRG-TR-005' }).first();
  await tr.locator('summary').click();
  await tr.locator('input[name=file]').setInputFiles('tests/fixtures/dn-40211.txt');
  await act(rania, tr.locator('button:has-text("Submit")'));
  check(/submitted for review/.test(await flash(rania)), 'estimator submits the flood test report');
  await omar.goto(B + '/client/docreview');
  await act(omar, omar.locator('section', { hasText: 'RGS-BRG-TR-005' }).first().locator('button[value=A]'));
  check(/code A/.test(await flash(omar)), 'consultant approves the flood test report (A)');

  // 7. Evidence and isolation
  const sup = await login('Joseph Mathew');
  await sup.goto(B + '/ops/evidence');
  await sup.locator('select[name=areaId]').selectOption({ label: (await sup.locator('select[name=areaId] option', { hasText: 'WP-R1' }).first().textContent()).trim() });
  await sup.fill('input[name=caption]', 'Roof L32 after flood test, outlet D-3');
  await sup.locator('input[name=file]').setInputFiles('public/brand/rgs-logo.png');
  await act(sup, 'button:has-text("Upload")');
  check(/Evidence added to WP-R1/.test(await flash(sup)), 'supervisor uploads evidence to WP-R1');
  await faris.goto(B + '/client/evidence');
  const href = await faris.locator('a[href^="/api/files/"]').first().getAttribute('href');
  check(!!href, 'client sees evidence on their project');
  const saad = await login('Saad Al-Otaibi');
  check((await saad.request.get(B + href)).status() === 404, 'another client cannot open that evidence file');

  // 8. Handover: request with open items, client signs completion, warranty certificate issued
  await ops.goto(B + '/ops/handover');
  const h = ops.locator('section', { hasText: 'PRJ-26-001' }).first();
  await h.locator('input[name=override]').check();
  await act(ops, h.locator('button:has-text("Request completion sign-off")'));
  check(/Completion sign-off sent/.test(await flash(ops)), 'ops requests completion for PRJ-26-001');
  await faris.goto(B + '/client/signoffs');
  const comp = faris.locator('section', { hasText: 'PRJ-26-001' }).filter({ hasText: /Completion|الإنجاز/ }).filter({ has: faris.locator('input[name=signature]') }).first();
  await comp.locator('input[name=signature]').fill('Faris Al-Ghamdi');
  await act(faris, comp.locator('button[value=approved]'));
  check(/warranties are active/.test(await flash(faris)), 'client signs completion → warranties active');
  await faris.goto(B + '/client/handover');
  const cert = await faris.locator('a[href^="/warranty/"]').first().getAttribute('href');
  check(!!cert, 'warranty certificate link appears');
  await faris.goto(B + cert);
  check((await faris.locator('text=Warranty Certificate').count()) === 1, 'warranty certificate renders');
  await faris.screenshot({ path: `${OUT}/warranty.png`, fullPage: true });
  check((await saad.goto(B + cert)).status() === 404, 'another client cannot open the certificate');

  // 9. Copilot
  const ask = async (p, text) => (await (await p.request.post(B + '/api/copilot', { data: { text, locale: 'en' } })).json());
  let j = await ask(saad, 'Any open NCRs on PRJ-26-002?');
  check(j.steps.some((s) => s.name === 'list_findings' && s.status === 'ok') && /NCR-26-001/.test(j.reply), 'client copilot list_findings');
  j = await ask(faris, 'Report an observation on PRJ-26-001: sealant missing at parapet corner');
  check(j.steps.some((s) => s.name === 'raise_finding' && s.status === 'ok'), `client copilot raise_finding → ${j.reply.split('\n')[0]}`);
  j = await ask(ops, 'Give me the HSE summary');
  check(j.steps.some((s) => s.name === 'hse_summary'), 'staff copilot hse_summary');
  j = await ask(ops, 'Which documents are under review?');
  check(j.steps.some((s) => s.name === 'document_status'), 'staff copilot document_status');
  j = await ask(ops, 'Is PRJ-26-002 ready for handover?');
  check(j.steps.some((s) => s.name === 'handover_status') && /readiness/.test(j.reply), 'staff copilot handover_status');

  console.log('ERRORS', errs.length ? errs : 'none');
  console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASSED');
  await b.close();
  process.exit(failures || errs.length ? 1 : 0);
})();
