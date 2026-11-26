/* Personas, hierarchy and personal agents, with the rehearsed Aramco offshore story across client ↔ RGS agents. */
const { chromium } = require('playwright');
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
    await p.context().addCookies([{ name: 'locale', value: 'en', url: B }]);
    return p;
  }
  const flash = async (p) => ((await p.locator('[role=status]').first().textContent().catch(() => '')) || '').trim();
  const runAgent = async (p, area) => { await p.goto(`${B}${area}/agent`); await p.locator('button:has-text("Run my agent now")').click(); await p.waitForURL(/msg=/, { timeout: 120000 }); return flash(p); };
  const act = async (p, loc) => { const u0 = p.url(); await loc.click(); await p.waitForURL((u) => u.toString() !== u0, { timeout: 60000 }); };

  // 1. Hierarchy and personas exist; every person has a named agent
  const gm = await login('Fahad Al-Rashid');
  await gm.goto(B + '/ops/agent');
  check((await gm.locator('h1:has-text("Fahad\'s Portfolio agent")').count()) === 1, 'GM has a named Portfolio agent');
  await gm.goto(B + '/ops/agents/team');
  const agents = await gm.locator('[data-agent-row]').count();
  check(agents >= 40, `every person has an agent (${agents})`);
  for (const a of ["Rania's Tender agent", "Tariq's Commercial agent", "Hesham's Quality agent", "Mona's People agent", "Ravi's Stores agent", "Mohammad's Crew agent", "Mariam's Document agent", "Lina's Pipeline agent", "Sameer's Project agent", "Abeer's Claim-check agent", "Waleed's Executive digest", "Ibrahim's Review agent"]) check((await gm.locator(`[data-agent-row]:has-text("${a}")`).count()) === 1, `agent: ${a}`);
  await gm.screenshot({ path: `${OUT}/team-agents.png`, fullPage: false });

  // 2. Aramco story, step 1: the client PM raises a large job
  const moh = await login('Mohammed Al-Dossary');
  await moh.goto(B + '/client/requests');
  await moh.locator('#title').fill('Riser balcony full encapsulation for insulation reinstatement');
  await moh.locator('#site').selectOption('KRN');
  await moh.locator('#description').fill('Tube and coupler scaffold 120 m long, 3 m wide, 40 m high, 26 weeks, offshore crew change Thursday.');
  await moh.locator('button:has-text("Send request")').click();
  await moh.waitForURL(/msg=/);
  const rq = ((await flash(moh)).match(/RQ-26-\d{4}/) || [])[0];
  check(!!rq, `Aramco PM raises ${rq}`);
  // The tender agent prices it in the background.
  const rania = await login('Rania Haddad');
  let quoteHref = null;
  for (let i = 0; i < 30 && !quoteHref; i++) {
    await rania.goto(B + '/ops/requests');
    const row = rania.locator('tr', { hasText: rq });
    if (await row.locator('a[href^="/ops/quotes/"]').count()) quoteHref = await row.locator('a[href^="/ops/quotes/"]').first().getAttribute('href');
    else { const r = rania.locator(`a:has-text("${rq}")`); if (await r.count()) { await r.first().click(); await rania.waitForLoadState('networkidle'); if (await rania.locator('a[href^="/ops/quotes/"]').count()) quoteHref = await rania.locator('a[href^="/ops/quotes/"]').first().getAttribute('href'); } }
    if (!quoteHref) await rania.waitForTimeout(1000);
  }
  check(!!quoteHref, 'tender agent priced a draft quote');
  // Step 2: the estimator sends it; above the ops manager's limit, so it goes to the GM.
  await rania.goto(B + quoteHref);
  await rania.locator('button:has-text("Submit")').first().click();
  await rania.waitForURL(/msg=/);
  check(/Submitted/.test(await flash(rania)), 'estimator submits the quote');
  const imran = await login('Imran Qureshi');
  await imran.goto(B + '/ops/approvals');
  const card = imran.locator('section', { hasText: 'send_quote' }).filter({ hasText: /SAR [\d,]+\)/ }).first();
  const amount = Number(((await card.textContent()).match(/SAR ([\d,]+)\)/) || [])[1]?.replace(/,/g, '') || 0);
  check(amount > 500000, `quote is SAR ${amount.toLocaleString()} (above SAR 500,000)`);
  await card.locator('button[value=approved]').click();
  await imran.waitForLoadState('networkidle');
  check(/above your approval limit.*General Manager/.test(await imran.locator('body').textContent()), 'ops manager is refused: above their limit, the GM approves');
  await gm.goto(B + '/ops/agent');
  await runAgent(gm, '/ops');
  check((await gm.locator('[data-item]:has-text("Needs you: Send quote")').count()) >= 1, "GM's agent surfaces the approval above managers' limits");
  await gm.goto(B + '/ops/approvals');
  await gm.locator('section', { hasText: 'send_quote' }).filter({ has: gm.locator('button[value=approved]') }).first().locator('button[value=approved]').click();
  await gm.waitForLoadState('networkidle');
  check(/executed|Sent|sent/i.test(await gm.locator('section', { hasText: 'send_quote' }).first().textContent()), 'GM approves and the quote is sent');
  // Step 3: the client accepts.
  await moh.goto(B + '/client/quotes/' + quoteHref.split('/').pop());
  await moh.locator('button[value=accepted]').click();
  await moh.waitForURL(/msg=/);
  check(/Thank you|شكراً/.test(await flash(moh)), 'Aramco PM accepts the quote');
  // The journey shows every handoff, client ↔ RGS agents.
  const reqHref = await (async () => { await rania.goto(B + '/ops/requests'); return rania.locator(`tr:has-text("${rq}") a[href^="/ops/requests/"]`).first().getAttribute('href'); })();
  await rania.goto(B + reqHref);
  await rania.locator('[data-journey-link]').click();
  await rania.waitForURL(/journeys/);
  const steps = await rania.locator('[data-step]').count();
  const tl = await rania.locator('[data-timeline]').textContent();
  check(steps >= 5 && /Tender agent/.test(tl) && /General Manager/.test(tl) && /Accepted/.test(tl), `journey: ${steps} handoffs from client to tender agent, GM and back`);
  await rania.screenshot({ path: `${OUT}/journey.png`, fullPage: true });
  await moh.goto(B + '/client/journeys');
  check((await moh.locator('[data-step]').count()) >= 5, 'client sees the same journey');

  // 3. Inbox triage: the tender agent turns WhatsApp and email into requests and quotes
  const t = await runAgent(rania, '/ops');
  check(/ran \d+ job/.test(t), `tender agent cycle (${t})`);
  check((await rania.locator('[data-item]:has-text("WhatsApp from")').count()) >= 1, 'WhatsApp RFQ triaged into a request');
  check((await rania.locator('[data-status=proposed]:has-text("ready to send")').count()) >= 1, 'priced quotes wait for the estimator to approve sending');

  // 4. Foreman voice report in Urdu becomes progress
  const fm = await login('Mohammad Aslam');
  await fm.goto(B + '/field/report');
  await fm.locator('select[name=areaId]').selectOption({ label: (await fm.locator('select[name=areaId] option', { hasText: 'IN-K1' }).first().textContent()).trim() });
  await fm.locator('textarea[name=transcript]').fill('آج IN-K1 پر 40 meter کلیڈنگ مکمل ہو گئی، ہوا کی وجہ سے ایک گھنٹہ کام رکا');
  await fm.locator('button:has-text("Send report")').click();
  await fm.waitForURL(/msg=/);
  check(/Logged on IN-K1: 40 lm at cladding/.test(await flash(fm)), `Urdu voice report logged (${(await flash(fm)).slice(0, 90)})`);
  await fm.screenshot({ path: `${OUT}/voice-report.png`, fullPage: true });

  // 5. QS agent proposes a claim; the owner approves it; the client's claim-check agent checks it
  const qs = await login('Tariq Mahmood');
  await runAgent(qs, '/ops');
  const claimItem = qs.locator('[data-status=proposed]', { hasText: 'PRJ-26-005: claim' }).first();
  check((await claimItem.count()) === 1, 'commercial agent proposes the Jeddah claim');
  const u0 = qs.url();
  await claimItem.locator('button:has-text("Approve")').click();
  await qs.waitForURL((u) => u.toString() !== u0);
  check(/sent to the client to certify/.test(await flash(qs)), `QS approves; claim sent (${(await flash(qs)).slice(0, 80)})`);
  const rk = await login('Rakan Al-Sulami');
  const rr = await runAgent(rk, '/client');
  check(/ran/.test(rr) && (await rk.locator('[data-item]:has-text("Needs your signature: Payment claim")').count()) >= 1, "Jeddah PM's agent flags the claim to sign");

  // 6. Other personas' agents do their own work
  for (const [who, area, re, label] of [
    ['Hesham Nabil', '/ops', /hold\/witness point|Quality trend/, 'QA/QC agent: hold points and NCR trend'],
    ['Mona Al-Zahrani', '/ops', /Booked|Saudization/, 'People agent: refreshers and Saudization'],
    ['Huda Al-Shehri', '/ops', /Chased: Invoice|invoice/i, 'Billing agent chases overdue invoices'],
    ['Nasser Al-Qahtani', '/ops', /Toolbox talk ready/, 'Safety agent drafts a multi-language toolbox talk'],
    ['Waleed Al-Shammari', '/client', /Portfolio:/, 'Aramco executive digest'],
    ['Abeer Al-Qahtani', '/client', /claims|checks out|No claims/, 'Aramco claim-check agent'],
    ['Mariam Al-Shehri', '/ops', /review|Review/, 'Document agent chases overdue reviews'],
  ]) {
    const p = await login(who);
    await runAgent(p, area);
    check((await p.locator('[data-item]').filter({ hasText: re }).count()) >= 1, label);
    await p.context().close();
  }
  await qs.goto(B + '/ops/agent');
  await qs.screenshot({ path: `${OUT}/my-agent.png`, fullPage: true });

  // 7. Drafts-only mode: done items become proposals
  await qs.locator('input[value=drafts]').check();
  await act(qs, qs.locator('button:has-text("Save")').first());
  check(/drafts only/.test(await flash(qs)), 'owner switches the agent to drafts only');

  // 8. Viewer's agent: read-only
  const reem = await login('Reem Al-Saleh');
  check(/ran/.test(await runAgent(reem, '/client')), "viewer's executive digest runs (read-only)");

  await b.close();
  if (errs.length) { console.log('ERRORS [', errs.join('\n'), ']'); failures++; }
  console.log(failures ? `${failures} failure(s)` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
