/* Every link and tab works: crawl the app as each role, follow every internal link, fail on any 4xx/5xx or unexpected sign-out. */
const { chromium } = require('playwright');
const B = process.env.BASE_URL || 'http://localhost:3100';
const MAX = Number(process.env.LINKS_MAX || 400);
let failures = 0;
const check = (ok, label) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`); if (!ok) failures++; };

const PEOPLE = [
  ['Khalid Al-Mutairi', '/ops'], ['Imran Qureshi', '/ops'], ['Huda Al-Shehri', '/ops'], ['Arjun Nair', '/ops'], ['Bilal Ahmed', '/ops'], ['Joseph Mathew', '/field'],
  ['Faris Al-Ghamdi', '/client'], ['Omar Saeed', '/client'], ['Reem Al-Saleh', '/client'], ['Abdulrahman Al-Hindi', '/client'],
];
// Links that change state or leave the app are not crawled.
const SKIP = [/^\/api\/(admin|workflows|watchers|copilot|field)/, /^\/login/, /^\/invite\//, /\/sign-?out/];

(async () => {
  const b = await chromium.launch();
  for (const [who, start] of PEOPLE) {
    const ctx = await b.newContext();
    const p = await ctx.newPage();
    await p.goto(B + '/login');
    await p.locator('button', { hasText: who }).first().click();
    await p.waitForLoadState('networkidle');
    await ctx.addCookies([{ name: 'locale', value: 'en', url: B }]);
    const seen = new Set(), queue = [start], bad = [];
    const norm = (href, from) => {
      if (!href || /^(mailto:|tel:|javascript:|#)/.test(href)) return null;
      let u; try { u = new URL(href, B + from); } catch { return null; }
      if (u.origin !== B) return null;
      u.hash = '';
      u.searchParams.delete('msg');
      const key = u.pathname + (u.search || '');
      if (SKIP.some((re) => re.test(u.pathname))) return null;
      return key;
    };
    while (queue.length && seen.size < MAX) {
      const path = queue.shift();
      if (seen.has(path)) continue;
      seen.add(path);
      const r = await p.request.get(B + path, { maxRedirects: 5 }).catch((e) => ({ status: () => 0, url: () => path, text: async () => '', headers: () => ({}), _e: e }));
      const status = r.status();
      const finalUrl = new URL(r.url());
      if (status >= 400 || status === 0) { bad.push(`${status} ${path}`); continue; }
      if (finalUrl.pathname.startsWith('/login') && !path.startsWith('/login')) { bad.push(`signed out at ${path}`); continue; }
      const ct = (r.headers()['content-type'] || '');
      if (!ct.includes('text/html')) continue;
      const html = await r.text();

      for (const m of html.matchAll(/href="([^"]+)"/g)) {
        const k = norm(m[1].replace(/&amp;/g, '&'), finalUrl.pathname);
        if (k && !seen.has(k)) queue.push(k);
      }
    }
    check(bad.length === 0, `${who}: ${seen.size} pages and links, ${bad.length} broken${bad.length ? `\n      ${bad.slice(0, 15).join('\n      ')}` : ''}`);
    await ctx.close();
  }
  await b.close();
  console.log(failures ? `${failures} failure(s)` : 'ALL PASS');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
