/* Phase A: projects, delivery tracking, instructions → variations, multi-role client sign-offs, notifications, isolation. */
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
  // Wait for the URL to change to a new result (server actions redirect with ?msg=...), not just any URL with msg=.
  const act = async (p, sel, re = /msg=/) => { const before = p.url(); await Promise.all([p.waitForURL((u) => u.toString() !== before && re.test(decodeURIComponent(u.toString())), { timeout: 60000 }), p.locator(sel).first().click()]); await p.waitForLoadState('networkidle'); };
  const clickNav = async (p, sel) => { const before = p.url(); await Promise.all([p.waitForURL((u) => u.toString() !== before, { timeout: 30000 }), p.locator(sel).first().click()]); await p.waitForLoadState('networkidle'); };
  const flash = async (p) => ((await p.locator('[role=status]').first().textContent().catch(() => '')) || '').trim();
  const signIn = async (p, cardText, name, decision = 'approved', comment = '') => {
    const card = p.locator('section', { hasText: cardText }).filter({ has: p.locator('input[name=signature]') }).first();
    if (comment) await card.locator('input[name=comment]').fill(comment);
    await card.locator('input[name=signature]').fill(name);
    await act(p, `section:has-text("${cardText}") button[value=${decision}]`);
    return flash(p);
  };

  // 1. Every new page renders for staff and client
  const ops = await login('Imran Qureshi');
  for (const path of ['/ops/oversight', '/ops/projects', '/ops/reports', '/ops/activity', '/ops/progress', '/ops/milestones', '/ops/dependencies', '/ops/triage', '/ops/instructions', '/ops/signoffs', '/ops/notifications']) {
    const r = await ops.goto(B + path); check(r.status() === 200, `staff ${path}`);
  }
  await ops.goto(B + '/ops/oversight'); await ops.screenshot({ path: `${OUT}/oversight.png`, fullPage: true });
  const faris = await login('Faris Al-Ghamdi'); // Al Bargash client PM (Arabic UI)
  for (const path of ['/client', '/client/projects', '/client/reports', '/client/activity', '/client/progress', '/client/milestones', '/client/dependencies', '/client/instructions', '/client/signoffs', '/client/notifications']) {
    const r = await faris.goto(B + path); check(r.status() === 200, `client ${path}`);
  }
  await faris.goto(B + '/client'); await faris.screenshot({ path: `${OUT}/client_overview.png`, fullPage: true });

  // 2. Variation ≤ SAR 100,000 needs only the client PM; a wrong signature is refused
  await faris.goto(B + '/client/signoffs');
  check((await faris.locator('section', { hasText: 'VO-26-0004' }).count()) > 0, 'Faris sees VO-26-0004 waiting');
  check(/Type your full name|اكتب اسمك/.test(await signIn(faris, 'VO-26-0004', 'Someone Else')), 'wrong signature name is refused');
  check(/approved|Approved|الاعتماد/.test(await signIn(faris, 'VO-26-0004', 'Faris Al-Ghamdi')), 'VO-26-0004 approved by PM alone');
  // 3. Measurement needs PM + consultant
  const m1 = await signIn(faris, 'MS-26-0012', 'Faris Al-Ghamdi');
  check(/waiting|بانتظار/i.test(m1), `measurement partially signed (${m1})`);
  const omar = await login('Omar Saeed');
  await omar.goto(B + '/client/signoffs');
  check(/Approved|certified/i.test(await signIn(omar, 'MS-26-0012', 'Omar Saeed')), 'consultant completes MS-26-0012 → quantities certified');

  // 4. Qiddiya: VO above SAR 100,000 needs PM + procurement; PMC releases the flood-test hold point
  const saad = await login('Saad Al-Otaibi');
  await saad.goto(B + '/client/signoffs');
  check(/بانتظار|waiting/i.test(await signIn(saad, 'VO-26-0005', 'Saad Al-Otaibi')), 'VO-26-0005 waits for procurement after PM signs');
  const nora = await login('Nora Al-Harbi');
  await nora.goto(B + '/client/signoffs');
  check(/الاعتماد|Approved/.test(await signIn(nora, 'VO-26-0005', 'Nora Al-Harbi')), 'procurement approves VO-26-0005');
  const peter = await login('Peter Walsh');
  await peter.goto(B + '/client/signoffs');
  check(/Hold point released|protection/i.test(await signIn(peter, 'flood test', 'Peter Walsh')), 'PMC releases tank T1 hold point');

  // 5. Client instruction → RGS prices a VO above the threshold → needs PM + procurement
  await faris.goto(B + '/client/instructions');
  await faris.fill('#title', 'Waterproof the new generator room plinths and trench');
  await faris.fill('#description', 'Per drawing E-GN-104 rev B. 6 plinths and a 40 m cable trench.');
  await act(faris, 'form:has(#title) button[type=submit]');
  const siMsg = await flash(faris); const siRef = (siMsg.match(/SI-\d{2}-\d{4}/) || [])[0];
  check(!!siRef, `client issues instruction (${siRef})`);
  await ops.goto(B + '/ops/instructions');
  const card = ops.locator('li', { hasText: siRef }).first();
  await card.locator('summary').click();
  await card.locator('input[name=d0]').fill('APP 2-layer to plinths and trench'); await card.locator('input[name=q0]').fill('1200'); await card.locator('input[name=r0]').fill('85');
  await card.locator('input[name=d1]').fill('Flood tests'); await card.locator('input[name=q1]').fill('4'); await card.locator('select[name=u1]').selectOption('each'); await card.locator('input[name=r1]').fill('1600');
  await Promise.all([ops.waitForURL(/msg=/), card.locator('button:has-text("Send priced variation")').click()]);
  const voMsg = await flash(ops);
  check(/procurement must also approve/.test(voMsg), `staff prices VO above SAR 100,000 (${voMsg.slice(0, 80)})`);
  await faris.goto(B + '/client/signoffs');
  const newVo = faris.locator('section', { hasText: 'generator room' }).first();
  check((await newVo.innerText()).match(/PM \+ finance|admin \+ finance|PM \+ procurement|PM \+ finance/i) !== null || (await newVo.innerText()).includes('finance'), 'new VO requires PM + finance');

  // 6. Supervisor logs progress; 7. Ops submits a measurement sheet to Sadara
  const sup = await login('Joseph Mathew');
  await sup.goto(B + '/ops/progress');
  const row = sup.locator('tr', { hasText: 'IN-K1' }).first();
  await row.locator('input[name=qty]').fill('50');
  await Promise.all([sup.waitForURL(/msg=/), row.locator('button:has-text("Log")').click()]);
  const logMsg = await flash(sup);
  check(/Logged on IN-K1. Installed now 350/.test(logMsg), `supervisor logs 50 lm on IN-K1 (${logMsg})`);
  await ops.goto(B + '/ops/projects');
  await clickNav(ops, 'a:has-text("PRJ-26-003")');
  await act(ops, 'button:has-text("Send measurement sheet")');
  check(/sent to the client for signature/.test(await flash(ops)), 'measurement sheet sent to Sadara');
  await ops.screenshot({ path: `${OUT}/project_detail.png`, fullPage: true });

  // 8. Client marks its own prerequisite met
  await faris.goto(B + '/client/dependencies');
  const depRow = faris.locator('li', { hasText: 'planter drainage' }).first();
  await Promise.all([faris.waitForURL(/msg=/), depRow.locator('button').click()]);
  check((await faris.locator('li', { hasText: 'planter drainage' }).first().innerText()).includes('met'), 'client marks its prerequisite met');

  // 9. Isolation: Faris can't open another client's project, report or sign-off
  const ids = await ops.evaluate(() => [...document.querySelectorAll('a[href^="/reports/"]')].map((a) => a.getAttribute('href')));
  const sadaraReport = ids[0];
  check((await faris.goto(B + sadaraReport)).status() === 404, 'client cannot open another client\'s weekly report');
  check((await faris.goto(B + sadaraReport.replace('/reports/', '/client/projects/'))).status() === 404, 'client cannot open another client\'s project');

  // 10. Notifications: bell count, mark all read
  await faris.goto(B + '/client/notifications');
  const before = await faris.locator('[aria-label="unread"]').count();
  await act(faris, 'button:has-text("تعليم الكل كمقروء"), button:has-text("Mark all read")');
  const after = await faris.locator('[aria-label="unread"]').count();
  check(before > 0 && after === 0, `notifications: ${before} unread → ${after}`);

  // 11. Copilot
  const ask = async (p, text, locale = 'en') => (await (await p.request.post(B + '/api/copilot', { data: { text, locale } })).json());
  let j = await ask(faris, 'What is waiting for my signature?');
  check(j.steps.some((s) => s.name === 'my_signoffs' && s.status === 'ok'), `client copilot my_signoffs → ${j.reply.split('\n')[0]}`);
  j = await ask(faris, 'Status of PRJ-26-001');
  check(j.steps.some((s) => s.name === 'project_status') && /PRJ-26-001/.test(j.reply), 'client copilot project_status');
  j = await ask(faris, 'Status of PRJ-26-003');
  check(/can't find PRJ-26-003|لا أجد/.test(j.reply), 'client copilot cannot see another client\'s project');
  j = await ask(ops, 'Record an instruction on PRJ-26-004: add 2 removable covers on riser valves');
  check(j.steps.some((s) => s.name === 'raise_instruction' && s.status === 'ok'), `staff copilot raise_instruction → ${j.reply.split('\n')[0]}`);

  // 12. Weekly report renders for the client
  await faris.goto(B + '/client/projects');
  await clickNav(faris, 'a[href^="/client/projects/"]');
  await clickNav(faris, 'a[href^="/reports/"]');
  check((await faris.locator('text=Weekly Progress Report').count()) === 1, 'client weekly report renders');
  await faris.screenshot({ path: `${OUT}/weekly_report.png`, fullPage: true });

  console.log('ERRORS', errs.length ? errs : 'none');
  console.log(failures ? `${failures} FAILURE(S)` : 'ALL PASSED');
  await b.close();
  process.exit(failures || errs.length ? 1 : 0);
})();
