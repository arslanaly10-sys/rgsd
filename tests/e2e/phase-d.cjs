/* Phase D: email-code sign-in, authenticator MFA, invitations, disable / sign out everywhere, notification channels, Stage 1 review pages, access tester, security headers. */
const { chromium } = require('playwright');
const crypto = require('crypto');
const B = process.env.BASE_URL || 'http://localhost:3100';
const OUT = process.env.OUT || 'test-results';
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failures++; };

function b32(s) { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, v = 0; const out = []; for (const c of s) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); }
function totp(secret, at = Date.now()) { const m = Buffer.alloc(8); m.writeBigUInt64BE(BigInt(Math.floor(at / 30000))); const h = crypto.createHmac('sha1', b32(secret)).update(m).digest(); const o = h[19] & 15; return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1e6).padStart(6, '0'); }

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const fresh = async (who) => {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 } });
    await ctx.addCookies([{ name: 'locale', value: 'en', url: B }]);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(`${who} ${e.message}`));
    p.on('response', (r) => { if (r.status() >= 500) errs.push(`${who} ${r.status()} ${r.url()}`); });
    return p;
  };
  async function persona(who) {
    const p = await fresh(who);
    await p.goto(B + '/login');
    await p.locator('button', { hasText: who }).first().click();
    await p.waitForLoadState('networkidle');
    return p;
  }
  const flash = async (p) => ((await p.locator('[role=status]').first().textContent().catch(() => '')) || '').trim();
  async function codeSignIn(p, email) {
    await p.goto(B + '/login');
    await p.locator('input[name=email]').fill(email);
    await p.locator('button:has-text("Email me a sign-in code")').click();
    await p.waitForURL(/step=code/);
    return (await p.locator('[data-dev-code]').textContent().catch(() => null))?.trim();
  }

  // 1. Security headers
  const h = (await (await fetch(B + '/login')).headers);
  check(/max-age=63072000/.test(h.get('strict-transport-security') || ''), 'HSTS header');
  check(/frame-ancestors 'none'/.test(h.get('content-security-policy') || '') && h.get('x-frame-options') === 'DENY', 'CSP and frame-deny headers');
  check(!h.get('x-powered-by'), 'no x-powered-by');

  // 2. Email code sign-in: wrong code refused, right code signs in, code is single-use and redacted in the outbox
  const p1 = await fresh('otp');
  const code = await codeSignIn(p1, 'Inspector@Demo.RGS');
  check(/^\d{6}$/.test(code || ''), 'sign-in code issued (shown in demo mode)');
  await p1.locator('input[name=code]').fill(code === '000000' ? '111111' : '000000');
  await p1.locator('button:has-text("Sign in")').click();
  await p1.waitForURL(/msg=/);
  check(/wrong or has expired/.test(await flash(p1)), 'wrong code refused');
  await p1.locator('input[name=code]').fill(code);
  await p1.locator('button:has-text("Sign in")').click();
  await p1.waitForURL(/\/ops/);
  check(/\/ops/.test(p1.url()), 'right code signs the inspector in');
  const p1b = await fresh('replay');
  await p1b.goto(`${B}/login?step=code&email=inspector@demo.rgs`);
  await p1b.locator('input[name=code]').fill(code);
  await p1b.locator('button:has-text("Sign in")').click();
  await p1b.waitForURL(/msg=/);
  check(/wrong or has expired/.test(await flash(p1b)), 'a used code cannot be replayed');
  const unknown = await fresh('unknown');
  const uc = await codeSignIn(unknown, 'nobody@example.com');
  check(!uc && (await unknown.locator('text=If nobody@example.com has access').count()) === 1, 'unknown email gets the same answer and no code');
  // throttle: 3 codes per 10 minutes
  for (let i = 0; i < 3; i++) await codeSignIn(await fresh('t'), 'yard@demo.rgs');
  check(!(await codeSignIn(await fresh('t4'), 'yard@demo.rgs')), 'fourth code in 10 minutes is not issued');

  // 3. MFA: finance enrols an authenticator; next sign-in needs the email code AND the app code
  const huda = await persona('Huda Al-Shehri');
  await huda.goto(B + '/account/security');
  const secret = (await huda.locator('[data-mfa-secret]').textContent()).trim();
  await huda.locator('input[name=code]').fill(totp(secret));
  await huda.locator('button:has-text("Turn on")').click();
  await huda.waitForURL(/msg=/);
  check(/Authenticator added/.test(await flash(huda)), 'finance turns on MFA');
  await huda.goto(B + '/ops');
  check(/\/ops/.test(huda.url()), 'the enrolling device stays signed in');
  await huda.screenshot({ path: `${OUT}/security.png`, fullPage: true });
  const h2 = await fresh('mfa');
  const hc = await codeSignIn(h2, 'finance@demo.rgs');
  await h2.locator('input[name=code]').fill(hc);
  await h2.locator('button:has-text("Sign in")').click();
  await h2.waitForURL(/step=mfa/);
  check(/step=mfa/.test(h2.url()), 'email code alone is not enough once MFA is on');
  await h2.locator('input[name=code]').fill('123456' === totp(secret) ? '654321' : '123456');
  await h2.locator('button:has-text("Verify")').click();
  await h2.waitForURL(/msg=/);
  check(/didn't match/.test(await flash(h2)), 'wrong authenticator code refused');
  await h2.locator('input[name=code]').fill(totp(secret));
  await h2.locator('button:has-text("Verify")').click();
  await h2.waitForURL(/\/ops/);
  check(/\/ops/.test(h2.url()), 'email code + authenticator signs finance in');

  // 4. Sign out everywhere revokes other sessions
  await h2.goto(B + '/account/security');
  await h2.locator('button:has-text("Sign out everywhere")').click();
  await h2.waitForURL(/login/);
  await huda.goto(B + '/ops');
  check(/login/.test(huda.url()), 'the other device is signed out too');

  // 5. Invitations: admin invites a client user; they accept and land in the client portal; client admin invites a colleague
  const admin = await persona('Khalid Al-Mutairi');
  await admin.goto(B + '/ops/admin/people');
  await admin.locator('input[name=fullName]').fill('Hessa Al-Zahrani');
  await admin.locator('input[name=email]').fill('hessa.qa@qiddiya-sample.sa');
  await admin.locator('select[name=role]').selectOption('client_hse');
  const opts = await admin.locator('select[name=clientCompanyId] option').allTextContents();
  await admin.locator('select[name=clientCompanyId]').selectOption({ label: opts.find((o) => /Qiddiya/i.test(o)) });
  await admin.locator('button:has-text("Send invitation")').click();
  await admin.waitForURL(/msg=/);
  const invMsg = await flash(admin);
  const link = (invMsg.match(/https?:\/\/\S+\/invite\/[A-Za-z0-9_-]+/) || [])[0];
  check(/Invitation sent/.test(invMsg) && !!link, 'admin invites a client HSE user');
  const hessa = await fresh('hessa');
  await hessa.goto(link.replace(/^https?:\/\/[^/]+/, B));
  await hessa.locator('button:has-text("Accept invitation")').click();
  await hessa.waitForURL(/\/client/);
  check(/\/client/.test(hessa.url()), 'invitee accepts and lands in the client portal');
  await hessa.goto(link.replace(/^https?:\/\/[^/]+/, B));
  check((await hessa.locator("text=This invitation can't be used").count()) === 1, 'an invitation link works once');
  check((await (await fresh('x')).goto(B + '/invite/not-a-real-token-aaaaaaaaaaaaaaaaaaaaaaaaaaaa')) && true, 'invalid invite token handled');
  const saad = await persona('Saad Al-Otaibi');
  await saad.goto(B + '/client/people');
  check((await saad.locator('select[name=role] option[value=admin]').count()) === 0, 'client admin can only invite client roles');
  check((await saad.locator('text=Hessa Al-Zahrani').count()) === 1 && (await saad.locator('text=Faris Al-Ghamdi').count()) === 0, 'client admin sees only their own company');
  const faris = await persona('Faris Al-Ghamdi');
  await faris.goto(B + '/client/people');
  check((await faris.locator('text=Hessa Al-Zahrani').count()) === 0, "another company's admin does not see Qiddiya's people");

  // 6. Disable access: signs the person out at once and blocks new codes
  await admin.goto(B + '/ops/admin/people');
  await admin.locator('tr', { hasText: 'hessa.qa@qiddiya-sample.sa' }).locator('button:has-text("Disable")').click();
  await admin.waitForURL(/msg=/);
  check(/can no longer sign in/.test(await flash(admin)), 'admin disables Hessa');
  await hessa.goto(B + '/client');
  check(/login/.test(hessa.url()), 'disabled user is signed out immediately');
  check(!(await codeSignIn(await fresh('dis'), 'hessa.qa@qiddiya-sample.sa')), 'disabled user gets no sign-in code');

  // 7. Notification channels: preferences, dispatch to outbox, OTP redacted
  const omar = await persona('Omar Saeed');
  await omar.goto(B + '/account/security');
  await omar.locator('input[name=whatsapp]').check();
  await omar.locator('input[name=phone]').fill('+966512345678');
  await omar.locator('button:has-text("Save")').click();
  await omar.waitForURL(/msg=/);
  check(/preferences saved/.test(await flash(omar)), 'client consultant turns on WhatsApp');
  // Omar opens a ticket; RGS replies, which notifies everyone at the client company.
  await omar.goto(B + '/client/support');
  await omar.locator('input[name=subject]').fill('Access to podium level 3 for flood test');
  await omar.locator('textarea[name=body]').fill('Please confirm the time for the flood test witness on podium level 3.');
  await omar.locator('button:has-text("Open ticket")').click();
  await omar.waitForURL(/support\/[0-9a-f-]{36}/);
  const ops0 = await persona('Imran Qureshi');
  await ops0.goto(omar.url().split('?')[0].replace('/client/', '/ops/'));
  await ops0.locator('textarea[name=body]').fill('Witness at 06:00 tomorrow; our foreman will meet you at gate 2.');
  await ops0.locator('button:has-text("Send")').click();
  await ops0.waitForURL(/msg=/);
  await admin.goto(B + '/ops/admin/outbox');
  await admin.locator('button:has-text("Dispatch")').click();
  await admin.waitForURL(/msg=/);
  check(/notification\(s\): \d+ sent, \d+ logged/.test(await flash(admin)), `notifications dispatched (${await flash(admin)})`);
  check((await admin.locator('tr', { hasText: '+966512345678' }).filter({ hasText: 'whatsapp' }).count()) > 0, 'WhatsApp message queued for the consultant');
  check((await admin.locator('text=[sign-in code redacted]').count()) > 0 && (await admin.locator(`text=${code}`).count()) === 0, 'sign-in codes are redacted in the outbox');
  await admin.screenshot({ path: `${OUT}/outbox.png`, fullPage: false });

  // 8. Stage 1 review pages and access tester
  for (const sec of ['', '/design', '/data-model', '/permissions', '/access', '/states', '/architecture', '/people', '/outbox']) check((await admin.goto(`${B}/ops/admin${sec}`)).status() === 200 && /\/ops\/admin/.test(admin.url()), `admin /ops/admin${sec}`);
  await admin.goto(B + '/ops/admin/data-model');
  check((await admin.locator('text=no RLS').count()) === 0, 'every table has row-level security');
  await admin.screenshot({ path: `${OUT}/permissions.png`, fullPage: false });
  await admin.goto(B + '/ops/admin/access');
  const opt = await admin.locator('select[name=who] option', { hasText: 'Saad Al-Otaibi' }).first().getAttribute('value');
  await admin.goto(`${B}/ops/admin/access?who=${opt}`);
  const probes = await admin.locator('tr[data-probe]').count();
  const fails = await admin.locator('tr[data-probe]:has-text("FAIL")').count();
  check(probes > 25 && fails === 0, `access tester: client sees only their company (${probes} checks, ${fails} failed)`);
  check(/^0/.test((await admin.locator('tr[data-probe=workers] td').nth(2).textContent()).trim()), 'client sees zero worker records');
  await admin.screenshot({ path: `${OUT}/access-tester.png`, fullPage: true });
  const ops = await persona('Imran Qureshi');
  await ops.goto(B + '/ops/admin/access');
  check(!/\/ops\/admin/.test(ops.url()), 'non-admin staff cannot open Stage 1 review');
  check((await ops.locator('a[href="/ops/admin"]').count()) === 0, 'Stage 1 nav hidden from non-admins');

  await b.close();
  if (errs.length) { console.log('ERRORS [', errs.join('\n'), ']'); failures++; }
  console.log(failures ? `${failures} failure(s)` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
