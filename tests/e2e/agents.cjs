const { chromium } = require('playwright');
const B = 'http://localhost:3100';
(async () => {
  const b = await chromium.launch();
  async function login(who, ar = false) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 900 } });
    const p = await ctx.newPage();
    p.on('pageerror', e => console.log('PAGEERROR', e.message));
    await p.goto(B + '/login');
    if (ar) { await p.click('text=العربية'); await p.waitForFunction(() => document.documentElement.dir === 'rtl'); }
    await p.locator('button', { hasText: who }).first().click();
    await p.waitForLoadState('networkidle');
    return { ctx, p };
  }
  let conv;
  async function ask(p, text, locale = 'en') {
    const r = await p.request.post(B + '/api/copilot', { data: { text, conversationId: conv, page: '/ops', locale } });
    const j = await r.json();
    conv = j.conversationId;
    console.log(`\n>>> ${text}\n[${j.agent}] steps: ${(j.steps || []).filter(s => s.kind === 'tool').map(s => `${s.name}:${s.status}`).join(', ') || '-'}\n${(j.reply || j.error || '').slice(0, 600)}`);
    return j;
  }
  const ops = await login('Imran Qureshi');
  await ask(ops.p, "Give me today's brief");
  await ask(ops.p, 'Which scaffolds are red at Sadara?');
  await ask(ops.p, 'Clear the red tag on KRN-0008, defect fixed, set tag to green');
  await ask(ops.p, 'Is Jubail low on boards?');
  await ask(ops.p, 'من لديه شهادات تنتهي خلال 30 يوماً؟', 'ar');
  await ask(ops.p, 'How should a red tag be cleared?');
  conv = undefined;
  const cl = await login('Mohammed Al-Dossary');
  await ask(cl.p, 'We need a cantilever scaffold 8 m long, 1.3 m wide, 2 lifts at Karan for 3 weeks. Price?');
  await ask(cl.p, 'Which scaffolds are red at Sadara?');
  await ask(cl.p, 'Request off-hire for KRN');
  // Screenshot the copilot UI as client
  await cl.p.goto(B + '/client');
  await cl.p.click('text=Ask OneSite AI').catch(() => cl.p.click('button[aria-label]'));
  await cl.p.locator('aside button', { hasText: 'red-tagged' }).click().catch(()=>{});
  await cl.p.waitForTimeout(1500);
  await cl.p.screenshot({ path: (process.env.OUT || 'test-results') + '/copilot_client.png' });
  // Inspector approves the tag change
  const ins = await login('Arjun Nair');
  await ins.p.goto(B + '/ops/approvals');
  const before = await ins.p.locator('text=Change tag KRN-0008').count();
  console.log('\ninspector sees tag approval:', before);
  await ins.p.locator('form', { has: ins.p.locator('input[value]') }).filter({ hasText: '' }).first();
  const card = ins.p.locator('section', { hasText: 'Change tag KRN-0008' });
  await card.locator('button[value=approved]').click();
  await ins.p.waitForLoadState('networkidle');
  console.log('flash:', (await ins.p.locator('main div.rounded-lg').first().textContent())?.trim());
  await ins.p.screenshot({ path: (process.env.OUT || 'test-results') + '/approvals.png' });
  // Ops manager tries to approve the client's off-hire (allowed: ops_manager)
  await ops.p.goto(B + '/ops/approvals');
  console.log('ops sees pending approve buttons:', await ops.p.locator('button[value=approved]').count());
  await b.close();
})();
