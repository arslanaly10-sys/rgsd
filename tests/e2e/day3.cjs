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
    await p.goto(B + '/login');
    await p.locator('button', { hasText: who }).first().click();
    await p.waitForLoadState('networkidle');
    return p;
  }
  const act = async (p, sel, re) => { await Promise.all([p.waitForURL(u => re.test(decodeURIComponent(u.toString())), { timeout: 60000 }), p.click(sel)]); await p.waitForLoadState('networkidle'); };
  const flash = async (p) => (await p.locator('[role=status]').first().textContent().catch(() => ''))?.trim();
  // 1. Estimator uploads RFQ and runs the Estimator
  const est = await login('Rania Haddad');
  await est.goto(B + '/ops/requests');
  await est.click('text=RQ-26-0412');
  await est.waitForLoadState('networkidle');
  await est.setInputFiles('#file', 'tests/fixtures/rfq-e417.pdf');
  await act(est, 'button:has-text("Upload")', /msg=/);
  console.log('upload:', await flash(est));
  await est.click('button:has-text("Run Estimator")');
  await est.waitForURL(/\/ops\/quotes\//, { timeout: 60000 });
  console.log('estimator:', await flash(est));
  const quoteUrl = est.url();
  const items = await est.locator('text=Extracted scope').locator('xpath=ancestor::section').innerText();
  console.log('scope card:\n' + items.slice(0, 700));
  console.log('total:', await est.locator('dd').filter({ hasText: 'SAR' }).last().textContent());
  await est.screenshot({ path: SP + '/shots/quote_editor.png', fullPage: true });
  // 2. Edit a rate and save with a lesson
  const rateInput = est.locator('input[name^=rate_]').first();
  await rateInput.fill('13.75');
  await est.fill('#lesson', 'Sadara turnaround: use negotiated erection rate 13.75/m3');
  await act(est, 'button:has-text("Save changes")', /Saved/);
  console.log('save:', await flash(est));
  await act(est, 'button:has-text("Submit for approval")', /Submitted|err:/);
  console.log('submit:', await flash(est));
  // 3. Ops approves sending
  const ops = await login('Imran Qureshi');
  await ops.goto(B + '/ops/approvals');
  await act(ops, 'section:has-text("Send quote") button[value=approved]', /msg=/);
  console.log('approve:', await flash(ops));
  // 4. Client accepts
  const cl = await login('Elena Petrova');
  await cl.goto(B + '/client/requests');
  await cl.locator('a[href^="/client/quotes/"]').first().click();
  await cl.waitForLoadState('networkidle');
  await cl.screenshot({ path: SP + '/shots/client_quote.png', fullPage: true });
  await cl.fill('#note', 'PO SDR-PO-78001 to follow');
  await act(cl, 'button:has-text("Accept quotation")', /msg=/);
  console.log('client accept:', await flash(cl));
  // 5. Another client creates a request; Estimator drafts in background
  const ar = await login('Mohammed Al-Dossary');
  await ar.goto(B + '/client/requests');
  await ar.fill('#title', 'Cantilever under cellar deck for valve change');
  await ar.fill('#description', 'Cantilever 8 m long, 1.3 m wide, 2 lifts, offshore Karan, 3 weeks hire');
  await ar.selectOption('#site', 'KRN');
  await act(ar, 'form:has(#title) button[type=submit]', /msg=/);
  console.log('client request:', await flash(ar));
  // 6. Copilot: estimator asks to estimate a request
  const r = await est.request.post(B + '/api/copilot', { data: { text: 'Estimate RQ-26-0415 please', locale: 'en' } });
  const j = await r.json();
  console.log('copilot:', j.agent, j.steps.map(s => s.name + ':' + s.status).join(','), '\n' + j.reply.slice(0, 400));
  // 7. Quote document
  await est.goto(quoteUrl.replace('/ops/quotes/', '/q/'));
  await est.screenshot({ path: SP + '/shots/quote_doc.png', fullPage: true });
  console.log('ERRORS', errs.length ? errs : 'none');
  await b.close();
})();
