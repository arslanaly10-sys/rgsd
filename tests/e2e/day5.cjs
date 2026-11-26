const { chromium } = require('playwright');
const B = 'http://localhost:3100', SP = (process.env.OUT || 'test-results');
(async () => {
  const b = await chromium.launch();
  const errs = [];
  async function login(who) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(who + ' ' + e.message));
    p.on('response', r => { if (r.status() >= 500) errs.push(`${who} ${r.status()} ${r.url()}`); });
    await p.goto(B + '/login'); await p.locator('button', { hasText: who }).first().click(); await p.waitForLoadState('networkidle');
    return p;
  }
  const act = async (p, sel, re = /msg=/) => { await Promise.all([p.waitForURL(u => re.test(decodeURIComponent(u.toString())), { timeout: 60000 }), p.click(sel)]); await p.waitForLoadState('networkidle'); };
  const flash = async (p) => (await p.locator('[role=status]').first().textContent().catch(() => ''))?.trim();
  const yard = await login('Bilal Ahmed');
  for (const f of ['dn-40211.txt', 'dn-40212-return.txt']) {
    await yard.goto(B + '/ops/fleet/movements/new');
    await yard.setInputFiles('#file', 'tests/fixtures/' + f);
    await act(yard, 'button:has-text("Read delivery note")', /msg=/);
    console.log('intake', f, '→', await flash(yard));
    await act(yard, 'button:has-text("Confirm and complete")', /completed\.|err:/);
    console.log('complete →', await flash(yard));
  }
  await yard.goto(B + '/ops/fleet/reconciliation');
  console.log('reconciliation rows:', await yard.locator('tbody tr').count());
  console.log((await yard.locator('tbody').innerText()).split('\n').filter(Boolean).slice(0, 30).join(' | '));
  await act(yard, 'button:has-text("Create tasks for gaps")');
  console.log('materials watcher →', await flash(yard));
  await yard.goto(B + '/ops/fleet/dispatch');
  await act(yard, 'button:has-text("Plan the day")');
  console.log('plan →', await flash(yard));
  await yard.screenshot({ path: SP + '/shots/dispatch.png', fullPage: true });
  await act(yard, 'button:has-text("Submit for approval")', /Submitted|err:/);
  console.log('submit plan →', await flash(yard));
  const ops = await login('Imran Qureshi');
  await ops.goto(B + '/ops/approvals');
  await act(ops, 'section:has-text("approve_dispatch_plan") button[value=approved]');
  console.log('ops approves plan →', (await ops.locator('main .rounded-lg').first().textContent()).trim());
  await ops.goto(B + '/ops/billing');
  await act(ops, 'button:has-text("Draft invoices for unbilled days")');
  console.log('draft invoices →', await flash(ops));
  await Promise.all([ops.waitForURL(/\/ops\/billing\/[0-9a-f-]{36}$/), ops.locator('a[href^="/ops/billing/"]').first().click()]); await ops.waitForLoadState('networkidle');
  const invUrl = ops.url();
  await act(ops, 'button:has-text("Submit for issue")');
  console.log('submit invoice →', await flash(ops));
  const fin = await login('Huda Al-Shehri');
  await fin.goto(B + '/ops/approvals');
  await act(fin, 'section:has-text("issue_invoice") button[value=approved]');
  console.log('finance approves →', (await fin.locator('main .rounded-lg').first().textContent()).trim());
  const invId = invUrl.split('/').pop();
  await fin.goto(B + '/inv/' + invId);
  console.log('QR present:', await fin.locator('text=ZATCA QR').count(), '|', (await fin.locator('article footer').innerText()).split('\n')[0].slice(0, 160));
  await fin.screenshot({ path: SP + '/shots/tax_invoice.png', fullPage: true });
  // Client sees the issued invoice (whose client? read it)
  const client = (await fin.locator('text=Buyer').locator('xpath=..').innerText()).split('\n')[1];
  console.log('invoice buyer:', client);
  // Copilot
  for (const q of ['Which materials are missing or unbilled?', "Plan tomorrow's deliveries"]) {
    const r = await ops.request.post(B + '/api/copilot', { data: { text: q, locale: 'en' } });
    const j = await r.json();
    console.log(`copilot "${q}" → [${j.agent}] ${j.steps.filter(s => s.kind === 'tool').map(s => s.name + ':' + s.status).join(',')}\n  ${j.reply.split('\n').slice(0, 4).join('\n  ')}`);
  }
  console.log('ERRORS', errs.length ? errs : 'none');
  await b.close();
})();
